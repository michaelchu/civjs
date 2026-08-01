import winston from 'winston';
import path from 'path';

// Do not flood the console during normal gameplay. Set LOG_LEVEL=info or debug
// explicitly when investigating turn processing or packet flow.
const logLevel = process.env.LOG_LEVEL || 'warn';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
      stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly'],
    }),
  ],
});

// Add file transport for local production runs.
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
    })
  );
  logger.add(
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
    })
  );
}

export default logger;
