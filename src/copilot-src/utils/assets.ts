import { putFile, getFileBlob } from "../api.ts";

const ASSET_PATH = "/data/storage/petal/siyuan-plugin-copilot/assets";

let generatedImageFileSequence = 0;

/**
 * 根据 MIME 类型获取图片文件扩展名
 */
export function getImageFileExtension(mimeType?: string): string {
    const ext = (mimeType || 'image/png').split('/')[1] || 'png';
    return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * 生成基于时间戳的图片文件名，避免重名覆盖
 */
export function createGeneratedImageFileName(mimeType?: string, index?: number): string {
    const now = new Date();
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    generatedImageFileSequence = (generatedImageFileSequence + 1) % 1000;
    const suffix = index === undefined ? generatedImageFileSequence : index + 1;
    return `${timestamp}-${pad(suffix, 3)}.${getImageFileExtension(mimeType)}`;
}

/**
 * 计算数据的 SHA-256 哈希值
 */
export async function calculateHash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 保存资源文件到插件存储目录
 * @param data 文件数据（Blob 或 ArrayBuffer）
 * @param fileName 原始文件名
 * @returns 返回保存在 SiYuan 中的路径
 */
export async function saveAsset(data: Blob | ArrayBuffer, fileName: string): Promise<string> {
    const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const hash = await calculateHash(arrayBuffer);

    // 改进后缀提取逻辑
    let ext = '';
    if (fileName && fileName.includes('.')) {
        ext = fileName.split('.').pop()?.toLowerCase() || '';
    }

    // 如果文件名没后缀，尝试从 blob mime type 获取
    if (!ext && data instanceof Blob && data.type) {
        ext = data.type.split('/').pop() || '';
        // 映射常见 MIME
        if (ext === 'jpeg') ext = 'jpg';
        if (ext === 'plain') ext = 'txt';
        if (ext === 'markdown') ext = 'md';
    }

    // 如果还是没后缀，默认 png
    if (!ext || ext === 'image') ext = 'png';

    const filePath = `${ASSET_PATH}/${hash}.${ext}`;

    try {
        // 尝试检查文件是否已存在 (现在的 getFileBlob 更可靠，JSON 报错会返回 null)
        const existing = await getFileBlob(filePath);
        if (existing && existing.size > 0) {
            return filePath;
        }
    } catch (e) {
        // 文件不存在，继续保存
    }

    const blob = data instanceof Blob ? data : new Blob([arrayBuffer]);
    const result = await putFile(filePath, false, blob);
    if (result === null) {
        console.error('putFile failed for asset:', filePath);
        throw new Error('Failed to save asset to SiYuan');
    }
    return filePath;
}

/**
 * 从 SiYuan 路径加载资源并转换为 Base64 或 Blob URL
 * @param path SiYuan 中的资源路径
 * @returns 返回可用于 img src 的字符串
 */
export async function loadAsset(path: string): Promise<string | null> {
    try {
        const blob = await getFileBlob(path);
        if (!blob) return null;
        return URL.createObjectURL(blob);
    } catch (e) {
        console.error('Failed to load asset:', path, e);
        return null;
    }
}

/**
 * 从 SiYuan 路径加载资源并转换为文本
 * @param path SiYuan 中的资源路径
 */
export async function readAssetAsText(path: string): Promise<string | null> {
    try {
        const blob = await getFileBlob(path);
        if (!blob) return null;
        return await blob.text();
    } catch (e) {
        console.error('Failed to read asset as text:', path, e);
        return null;
    }
}

/**
 * 将 Base64 转换为 Blob
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
    // 如果包含 data: 前缀，提取实际的 base64 数据
    let base64Data = base64;
    if (base64.includes(',')) {
        base64Data = base64.split(',')[1];
    }

    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
}
