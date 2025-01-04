import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

const logFile = path.join(LOG_DIR, `mygate_${new Date().toISOString().split('T')[0]}.log`);

const logger = {
    log: (level, message, value = '') => {
        const now = new Date().toISOString();

        const colors = {
            info: chalk.green,
            warn: chalk.yellow,
            error: chalk.red,
            success: chalk.blue,
            debug: chalk.magenta,
        };

        const color = colors[level] || chalk.white;
        const levelTag = `[ ${level.toUpperCase()} ]`;
        const timestamp = `[ ${now} ]`;

        const formattedMessage = `${chalk.green("[ Mygate-Node ]")} ${chalk.cyanBright(timestamp)} ${color(levelTag)} ${message}`;

        let formattedValue = ` ${chalk.green(value)}`;
        if (level === 'error') {
            formattedValue = ` ${chalk.red(value)}`;
        }
        if (typeof value === 'object') {
            const valueColor = level === 'error' ? chalk.red : chalk.green;
            formattedValue = ` ${valueColor(JSON.stringify(value))}`;
        }

        console.log(`${formattedMessage}${formattedValue}`);
    },

    writeToFile: (level, message, value) => {
        const now = new Date().toISOString();
        const logMessage = `${now} [${level.toUpperCase()}] ${message} ${value}\n`;
        fs.appendFileSync(logFile, logMessage);
    },

    info: (message, value = '') => {
        logger.log('info', message, value);
        logger.writeToFile('info', message, value);
    },
    warn: (message, value = '') => {
        //logger.log('warn', message, value);
        //logger.writeToFile('warn', message, value);
    },
    error: (message, value = '') => {
        logger.log('error', message, value);
        logger.writeToFile('error', message, value);
    },
    success: (message, value = '') => {
        logger.log('success', message, value);
        logger.writeToFile('success', message, value);
    },
    debug: (message, value = '') => {
        logger.log('debug', message, value);
        logger.writeToFile('debug', message, value);
    },
};

export default logger;
