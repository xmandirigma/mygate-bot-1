export const config = {
    api: {
        baseUrl: 'https://api.mygate.network',
        endpoints: {
            nodes: '/api/front/nodes',
            users: '/api/front/users/me',
            referrals: '/api/front/referrals/referral/oSmV1U'
        }
    },
    retry: {
        maxAttempts: 3,
        baseDelay: 10000,
        maxDelay: 60000
    },
    websocket: {
        reconnectInterval: 5000,
        maxConcurrentConnections: 50,
        pingInterval: 30000
    },
    proxy: {  // Add this section
        testTimeout: 5000,
        rotationInterval: 600000 // 10 minutes
    }
};
