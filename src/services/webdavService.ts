import { Clipping } from '../types';

export interface WebDAVConfig {
  url: string;
  username: string;
  appPassword: string;
}

export type SyncStatus = 'synced' | 'syncing' | 'disconnected' | 'error';

class WebDAVService {
  private config: WebDAVConfig | null = null;
  private fileName = 'kindle_data.json';

  // 设置 WebDAV 配置信息
  setConfig(config: WebDAVConfig) {
    this.config = config;
  }

  // 获取请求头，包含 Basic Auth 鉴权信息
  private getHeaders() {
    if (!this.config) throw new Error('WebDAV not configured');
    // 使用 btoa 进行 Base64 编码，实现 Basic Auth
    const auth = btoa(`${this.config.username}:${this.config.appPassword}`);
    return {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };
  }

  // 封装一个通用的 fetch 请求函数，通过后端代理绕过 CORS 限制
  private async proxyFetch(targetUrl: string, options: RequestInit = {}) {
    const headers = {
      ...this.getHeaders(),
      ...(options.headers || {}),
      'X-Target-URL': targetUrl,
    };

    const response = await fetch('/api/webdav-proxy', {
      ...options,
      headers,
    });

    return response;
  }

  // 获取完整文件 URL
  private getFullUrl(): string {
    if (!this.config) return '';
    // 确保 URL 以斜杠结尾，这是 WebDAV 目录的规范
    const baseUrl = this.config.url.endsWith('/') ? this.config.url : `${this.config.url}/`;
    return `${baseUrl}${this.fileName}`;
  }

  // 测试连接是否有效
  async testConnection(): Promise<boolean> {
    if (!this.config) return false;
    try {
      // 确保测试的是目录本身
      const testUrl = this.config.url.endsWith('/') ? this.config.url : `${this.config.url}/`;
      const response = await this.proxyFetch(testUrl, {
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
        },
      });
      return response.ok || response.status === 207;
    } catch (error) {
      console.error('WebDAV connection test failed:', error);
      return false;
    }
  }

  // 从云端读取 kindle_data.json 文件
  async loadData(): Promise<Clipping[] | null> {
    if (!this.config) return null;
    const fullUrl = this.getFullUrl();
    
    try {
      const response = await this.proxyFetch(fullUrl, {
        method: 'GET',
      });

      // 如果文件不存在，返回 null
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.statusText}`);
      }

      // 解析云端 JSON 数据
      return await response.json();
    } catch (error) {
      console.error('WebDAV load failed:', error);
      throw error;
    }
  }

  // 将数据以 JSON 格式保存到云端 kindle_data.json
  async saveData(data: Clipping[]): Promise<void> {
    if (!this.config) return;
    const fullUrl = this.getFullUrl();

    try {
      const response = await this.proxyFetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: JSON.stringify(data),
      });

      if (response.status === 404) {
        throw new Error('坚果云路径不存在。请确保填写的 URL 文件夹已在坚果云中手动创建。');
      }

      if (!response.ok) {
        throw new Error(`Failed to save data: ${response.statusText}`);
      }
    } catch (error) {
      console.error('WebDAV save failed:', error);
      throw error;
    }
  }
}

export const webdavService = new WebDAVService();
