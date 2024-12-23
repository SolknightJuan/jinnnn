const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
try {
    fs.mkdirSync(logsDir, { recursive: true });
} catch (error) {
    console.error('Error creating logs directory:', error);
    process.exit(1);
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Create transport for all logs
const allLogsTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Create transport for error logs
const errorLogsTransport = new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level: 'error',
    format: logFormat
});

// Create transport for component-specific logs
const createComponentTransport = (component) => new winston.transports.DailyRotateFile({
    filename: path.join(logsDir, `${component}-%DATE%.log`),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat
});

// Create console transport with custom format
const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(({ level, message, timestamp, component, ...meta }) => {
            let logMessage = `${timestamp} [${level}]`;
            if (component) {
                logMessage += ` [${component}]`;
            }
            logMessage += `: ${message}`;
            
            // Add metadata if present
            if (Object.keys(meta).length > 0 && meta.error !== undefined) {
                logMessage += `\n${JSON.stringify(meta, null, 2)}`;
            }
            
            return logMessage;
        })
    )
});

// Create loggers for different components
const createLogger = (component) => {
    return winston.createLogger({
        level: process.env.LOG_LEVEL || 'info',
        defaultMeta: { component },
        transports: [
            consoleTransport,
            allLogsTransport,
            errorLogsTransport,
            createComponentTransport(component)
        ]
    });
};

// Create specific loggers
const loggers = {
    database: createLogger('database'),
    twitter: createLogger('twitter'),
    youtube: createLogger('youtube'),
    commands: createLogger('commands'),
    system: createLogger('system')
};

// Helper function to get logger by component
const getLogger = (component) => {
    return loggers[component] || loggers.system;
};

// Export individual loggers and helper function
module.exports = {
    ...loggers,
    getLogger
};
