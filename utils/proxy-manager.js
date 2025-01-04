import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';
import { config } from '../config.js';
import log from '../utils/logger.js';

export class ProxyManager {
    constructor(proxies) {
        this.proxies = proxies;
        this.currentIndex = 0;
        this.healthyProxies = new Set(proxies);
    }

    async validateProxy(proxy) {
        const agent = new HttpsProxyAgent(proxy);
        try {
            log.info(`Testing proxy: ${proxy}`);
            const controller = new AbortController();
            const timeout = setTimeout(() => {
                controller.abort();
            }, config.proxy.testTimeout || 5000);

            const response = await fetch(config.api.baseUrl, {
                agent,
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            clearTimeout(timeout);
            
            if (response.ok) {
                log.info(`Proxy validated successfully: ${proxy}`);
                return true;
            } else {
                log.warn(`Proxy validation failed with status ${response.status}: ${proxy}`);
                return false;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                log.warn(`Proxy timeout: ${proxy}`);
            } else {
                log.warn(`Proxy validation error: ${proxy} - ${error.message}`);
            }
            return false;
        }
    }

    async getNextHealthyProxy() {
        if (this.healthyProxies.size === 0) {
            log.warn('No healthy proxies available, attempting to revalidate all proxies...');
            await this.validateAllProxies();
            
            if (this.healthyProxies.size === 0) {
                // If still no healthy proxies, try the original list
                log.warn('No healthy proxies after revalidation, using original proxy list');
                this.healthyProxies = new Set(this.proxies);
            }
        }

        const proxiesArray = Array.from(this.healthyProxies);
        this.currentIndex = (this.currentIndex + 1) % proxiesArray.length;
        const selectedProxy = proxiesArray[this.currentIndex];
        log.info(`Selected proxy: ${selectedProxy}`);
        return selectedProxy;
    }

    async validateAllProxies() {
        log.info(`Starting validation of ${this.proxies.length} proxies...`);
        
        const validationResults = await Promise.all(
            this.proxies.map(async proxy => {
                const isHealthy = await this.validateProxy(proxy);
                return { proxy, isHealthy };
            })
        );

        const healthyProxies = validationResults
            .filter(result => result.isHealthy)
            .map(result => result.proxy);

        this.healthyProxies = new Set(healthyProxies);
        
        log.info(`Proxy validation complete. ${this.healthyProxies.size} healthy proxies found out of ${this.proxies.length} total`);
        
        if (this.healthyProxies.size === 0) {
            log.warn('No healthy proxies found during validation. Will use proxies without validation.');
            this.healthyProxies = new Set(this.proxies);
        }
    }
}
