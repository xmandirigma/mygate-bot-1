import WebSocket from 'ws';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'fs';
import log from './utils/logger.js';
import bedduSalama from './utils/banner.js';
import { config } from './config.js';
import { ProxyManager } from './utils/proxy-manager.js';
import { RateLimiter } from './utils/rate-limiter.js';

function readFile(pathFile) {
    try {
        const datas = fs.readFileSync(pathFile, 'utf8')
            .split('\n')
            .map(data => data.trim())
            .filter(data => data.length > 0)
            .map(data => {
                // If it's a proxy, ensure it has the proper format
                if (pathFile.includes('proxy.txt')) {
                    // Check if proxy already has http:// or https:// prefix
                    if (!data.startsWith('http://') && !data.startsWith('https://')) {
                        return `http://${data}`; // Add http:// prefix if missing
                    }
                }
                return data;
            });
        
        if (datas.length === 0) {
            log.warn(`No data found in ${pathFile}`);
        } else {
            log.info(`Successfully read ${datas.length} entries from ${pathFile}`);
        }
        
        return datas;
    } catch (error) {
        log.error(`Error reading file ${pathFile}: ${error.message}`);
        return [];
    }
}

class WebSocketClient {
    constructor(token, proxy, uuid, reconnectInterval = config.websocket.reconnectInterval) {
        this.token = token;
        this.proxy = proxy;
        this.socket = null;
        this.reconnectInterval = reconnectInterval;
        this.shouldReconnect = true;
        this.agent = this.proxy ? new HttpsProxyAgent(this.proxy) : null;
        this.uuid = uuid;
        this.url = `wss://api.mygate.network/socket.io/?nodeId=${this.uuid}&EIO=4&transport=websocket`;
        this.regNode = `40{ "token":"Bearer ${this.token}"}`;
        this.pingInterval = null;
        this.lastPingTime = Date.now();
        this.messageQueue = [];
        this.processingQueue = false;
    }

    setupPing() {
        this.pingInterval = setInterval(() => {
            if (Date.now() - this.lastPingTime > config.websocket.pingInterval * 2) {
                log.warn(`No ping response received for ${this.uuid}, reconnecting...`);
                this.reconnect();
            } else {
                this.socket.send('2');
            }
        }, config.websocket.pingInterval);
    }
    
    connect() {
        if (!this.uuid || !this.url) {
            log.error("Cannot connect: Node is not registered.");
            return;
        }

        log.info("Attempting to connect :", this.uuid);
        this.socket = new WebSocket(this.url, { agent: this.agent });

        this.socket.onopen = async () => {
            log.info("WebSocket connection established for node:", this.uuid);
            await new Promise(resolve => setTimeout(resolve, 3000));
            this.reply(this.regNode);
            this.setupPing();
            this.processMessageQueue(); // Start processing queued messages
        };

        this.socket.onmessage = (event) => {
            if (event.data === "2" || event.data === "41") {
                this.socket.send("3");
                this.lastPingTime = Date.now();
            } else {
                log.info(`node ${this.uuid} received message:`, event.data);
            }
        };

        this.socket.onclose = () => {
            log.warn("WebSocket connection closed for node:", this.uuid);
            if (this.shouldReconnect) {
                log.warn(`Reconnecting in ${this.reconnectInterval / 1000} seconds for node:`, this.uuid);
                this.reconnect();
            }
        };
        
        this.socket.onerror = (error) => {
            log.error(`WebSocket error for node ${this.uuid}:`, error.message);
            this.socket.close();
        };
    }

    queueMessage(message) {
        this.messageQueue.push(message);
        if (!this.processingQueue) {
            this.processMessageQueue();
        }
    }

    async processMessageQueue() {
        if (this.processingQueue || this.messageQueue.length === 0) return;
        this.processingQueue = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue[0];
            try {
                await this.reply(message);
                this.messageQueue.shift(); // Remove sent message
            } catch (error) {
                log.error(`Failed to send message: ${error.message}`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
        }

        this.processingQueue = false;
    }

    reply(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(String(message));
            log.info("Replied with:", message);
        } else {
            log.error("Cannot send message; WebSocket is not open.");
        }
    }

    reconnect() {
        log.warn(`Attempting to reconnect WebSocket for node ${this.uuid}`);
        if (this.socket) {
            this.cleanup();
        }
        setTimeout(() => this.connect(), this.reconnectInterval);
    }
    
    disconnect() {
        this.shouldReconnect = false;
        if (this.socket) {
            this.socket.close();
        }
        log.info("WebSocket connection manually closed.");
    }

    cleanup() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        if (this.socket) {
            this.socket.close();
        }
    }
}

async function registerNode(token, proxy = null, retryCount = 0) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : null;
    const uuid = randomUUID();
    const activationDate = new Date().toISOString();
    const payload = {
        id: uuid,
        status: "Good",
        activationDate: activationDate,
    };

    try {
        const response = await fetch(`${config.api.baseUrl}${config.api.endpoints.nodes}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
            agent: agent,
        });

        if (!response.ok) {
            throw new Error(`Registration failed with status ${response.status}`);
        }
        const data = await response.json();
        log.info("Node registered successfully:", data);
        return uuid;

    } catch (error) {
        log.error("Error registering node:", error.message);
        if (retryCount < config.retry.maxAttempts) {
            const delay = Math.min(
                config.retry.baseDelay * Math.pow(2, retryCount),
                config.retry.maxDelay
            );
            log.info(`Retrying in ${delay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return registerNode(token, proxy, retryCount + 1);
        } else {
            log.error("Max retries exceeded; giving up on registration.");
            return null;
        }
    }
}

async function confirmUser(token, proxy = null) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : null;
    try {
        const confirm = await fetch(`${config.api.baseUrl}${config.api.endpoints.referrals}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({}),
            agent: agent,
        });
        const confirmData = await confirm.json();
        log.info("Confirm user response:", confirmData);
    } catch (error) {
        log.error("Error confirming user:", error.message);
        throw error;
    }
}

async function getUserInfo(token, proxy = null) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : null;
    try {
        const response = await fetch(`${config.api.baseUrl}${config.api.endpoints.users}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
            },
            agent: agent,
        });
        if (!response.ok) {
            log.error(`Failed to get user info with status ${response.status}`);
            return;
        }
        const data = await response.json();
        const { name, status, _id, levels, currentPoint } = data.data;
        log.info("User info:", { name, status, _id, levels, currentPoint });
    } catch (error) {
        log.error("Error getting user info:", error.message);
        return { error: error.message };
    }
}

async function main() {
    log.info(bedduSalama);
    const activeConnections = new Set();
    const rateLimiter = new RateLimiter(100, 60000);

    try {
        const tokens = readFile("tokens.txt");
        const proxies = readFile("proxy.txt");
        
        if (proxies.length === 0) {
            log.error("No proxies found in proxy.txt file");
            return;
        }
        
        log.info(`Loaded ${proxies.length} proxies`);
        const proxyManager = new ProxyManager(proxies);
        
        // Validate proxies before starting
        log.info("Validating proxies...");
        await proxyManager.validateAllProxies();
        
        if (proxyManager.healthyProxies.size === 0) {
            log.error("No healthy proxies found after validation");
            return;
        }
        
        log.info(`${proxyManager.healthyProxies.size} healthy proxies available`);

        for (let i = 0; i < tokens.length; i++) {
            await rateLimiter.waitForAvailableSlot();
            
            if (activeConnections.size >= config.websocket.maxConcurrentConnections) {
                log.warn('Maximum concurrent connections reached, waiting...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const token = tokens[i];
            const proxy = await proxyManager.getNextHealthyProxy();
            
            if (!proxy) {
                log.error("No healthy proxy available, skipping connection");
                continue;
            }
            
            try {
                log.info("Using proxy:", proxy);
                await confirmUser(token, proxy); // Add proxy parameter
                const uuid = await registerNode(token, proxy);
                
                if (!uuid) {
                    log.error("Failed to register node; skipping WebSocket connection.");
                    continue;
                }

                const client = new WebSocketClient(token, proxy, uuid);
                activeConnections.add(client);
                client.connect();
                
                await getUserInfo(token, proxy);

                // Setup periodic user info updates
                setInterval(async () => {
                    await rateLimiter.waitForAvailableSlot();
                    await getUserInfo(token, proxy);
                }, 10 * 60 * 1000);
            } catch (error) {
                log.error(`Error setting up connection for token ${i + 1}:`, error.message);
            }
        }
        
        log.info(`Successfully established ${activeConnections.size} connections`);
    } catch (error) {
        log.error("Fatal error in main process:", error);
        shutdown();
    }
}

main();
