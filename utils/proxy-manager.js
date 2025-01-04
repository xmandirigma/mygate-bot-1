import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { config } from './config.js';

export class ProxyManager {
    constructor(proxies) {
        this.proxies = proxies;
        this.currentIndex = 0;
        this.healthyProxies = new Set(proxies);
    }

    async validateProxy(proxy) {
        const agent = new HttpsProxyAgent(proxy);
        try {
            const response = await fetch(config.api.baseUrl, {
                agent,
                timeout: config.proxy.testTimeout
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async getNextHealthyProxy() {
        if (this.healthyProxies.size === 0) {
            // Revalidate all proxies if none are healthy
            await this.validateAllProxies();
        }

        const proxiesArray = Array.from(this.healthyProxies);
        this.currentIndex = (this.currentIndex + 1) % proxiesArray.length;
        return proxiesArray[this.currentIndex];
    }

    async validateAllProxies() {
        const validationResults = await Promise.all(
            this.proxies.map(async proxy => ({
                proxy,
                isHealthy: await this.validateProxy(proxy)
            }))
        );

        this.healthyProxies = new Set(
            validationResults
                .filter(result => result.isHealthy)
                .map(result => result.proxy)
        );
    }
}