import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly client: AxiosInstance;
  private cookies = '';

  constructor() {
    const proxyUrl = process.env.PROXY_URL;
    const httpsAgent = proxyUrl
      ? new HttpsProxyAgent(
          process.env.PROXY_USERNAME
            ? `http://${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@${proxyUrl.replace(/^https?:\/\//, '')}`
            : proxyUrl,
        )
      : undefined;

    this.client = axios.create({
      timeout: 30000,
      maxRedirects: 5,
      ...(httpsAgent && { httpsAgent, proxy: false }),
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    });
  }

  async fetchPage(url: string, retries = 3): Promise<cheerio.CheerioAPI | null> {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.logger.debug(`Fetching (attempt ${attempt}): ${url}`);

        const response = await this.client.get<string>(url, {
          headers: {
            'User-Agent': userAgent,
            ...(this.cookies && { Cookie: this.cookies }),
          },
          responseType: 'text',
        });

        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
          const cookieMap = new Map<string, string>();
          if (this.cookies) {
            for (const part of this.cookies.split('; ')) {
              const [key] = part.split('=');
              if (key) cookieMap.set(key, part);
            }
          }

          for (const raw of setCookies) {
            const pair = raw.split(';')[0];
            const [key] = pair.split('=');
            if (key) cookieMap.set(key, pair);
          }
          this.cookies = [...cookieMap.values()].join('; ');
        }

        const $ = cheerio.load(response.data);

        if (
          $('form[action*="validateCaptcha"]').length > 0 ||
          $('#captchacharacters').length > 0 ||
          $('title').text().includes('Robot Check')
        ) {
          this.logger.warn(`CAPTCHA detected on: ${url}`);
          return null;
        }

        return $;
      } catch (error: any) {
        const status = error.response?.status;

        if ((status === 503 || status === 429) && attempt < retries) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          this.logger.warn(`Got ${status}, retrying in ${Math.round(backoff)}ms...`);
          await this.delay(backoff);
          continue;
        }

        this.logger.error(`Failed to fetch ${url}: ${error.message}`);
        return null;
      }
    }

    return null;
  }

  async randomDelay(minMs = 1500, maxMs = 4000): Promise<void> {
    await this.delay(Math.floor(Math.random() * (maxMs - minMs) + minMs));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
