/**
 * Universal Logger Dump - Pure TypeScript, Zero Dependencies
 * This logger is designed to be compiled and embedded in Bootstrap Manager
 * Supports: DEBUG, INFO, WARN, ERROR, D_I (Dependency Issue), FATAL
 * 
 * DUMP means: Designed, Universal, Multi-Platform, Package-able
 * Can be embedded in Bootstrap as logger.js for any Node.js process
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  DEPENDENCY_ISSUE = 3.5,
  FATAL = 4,
}

export interface LoggerConfig {
  serviceName: string;
  threadId?: string;
  level?: LogLevel;
  colorize?: boolean;
  format?: 'json' | 'text';
  silent?: boolean;
  logFile?: string;
}

/**
 * ANSI Color codes for terminal output
 */
const Colors = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  
  // Foreground colors
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m',
};

/**
 * Logger class - Universal, embeddable logging for all runtimes
 */
export class Logger {
  private serviceName: string;
  private threadId: string;
  private level: LogLevel;
  private colorize: boolean;
  private format: 'json' | 'text';
  private silent: boolean;
  private logFile?: string;

  constructor(config: LoggerConfig) {
    this.serviceName = config.serviceName;
    this.threadId = config.threadId || 'unknown';
    this.level = config.level ?? LogLevel.INFO;
    this.silent = config.silent ?? false;
    this.logFile = config.logFile;
    
    // Auto-detect colorize if not specified
    if (config.colorize !== undefined) {
      this.colorize = config.colorize;
    } else {
      this.colorize = this.isTerminal();
    }
    
    this.format = config.format ?? 'text';
  }

  /**
   * Check if output is going to a terminal
   */
  private isTerminal(): boolean {
    return typeof process !== 'undefined' && 
           process.stdout && 
           typeof process.stdout.isTTY === 'boolean' &&
           process.stdout.isTTY;
  }

  /**
   * Get timestamp in format HH:MM:SS.mmm
   */
  private getTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Format log message
   */
  private formatMessage(level: LogLevel, message: string, context?: any): string {
    const timestamp = this.getTimestamp();
    const levelStr = this.getLevelName(level);
    
    if (this.format === 'json') {
      return JSON.stringify({
        timestamp,
        level: levelStr,
        service: this.serviceName,
        thread: this.threadId,
        message,
        ...(context && { context }),
      });
    }
    
    // Text format
    let output = `[${timestamp}] [${levelStr}]`;
    
    if (this.serviceName) {
      output += ` [${this.serviceName}]`;
    }
    
    if (this.threadId && this.threadId !== 'unknown') {
      output += ` {${this.threadId}}`;
    }
    
    output += ` ${message}`;
    
    if (context) {
      if (typeof context === 'object') {
        output += ` ${JSON.stringify(context)}`;
      } else {
        output += ` ${context}`;
      }
    }
    
    return output;
  }

  /**
   * Apply color to formatted message
   */
  private colorizeMessage(message: string, level: LogLevel): string {
    if (!this.colorize) {
      return message;
    }

    const colorCode = this.getColorForLevel(level);
    return `${colorCode}${message}${Colors.RESET}`;
  }

  /**
   * Get color code for log level
   */
  private getColorForLevel(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return Colors.CYAN;
      case LogLevel.INFO:
        return Colors.GREEN;
      case LogLevel.WARN:
        return Colors.YELLOW;
      case LogLevel.ERROR:
      case LogLevel.DEPENDENCY_ISSUE:
        return Colors.RED;
      case LogLevel.FATAL:
        return `${Colors.BOLD}${Colors.RED}`;
      default:
        return Colors.WHITE;
    }
  }

  /**
   * Get level name as string
   */
  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
      case LogLevel.DEPENDENCY_ISSUE:
        return 'D_I';
      case LogLevel.FATAL:
        return 'FATAL';
      default:
        return `UNKNOWN(${level})`;
    }
  }

  /**
   * Check if message should be logged based on level
   */
  private shouldLog(level: LogLevel): boolean {
    return !this.silent && level >= this.level;
  }

  /**
   * Write to console and optionally to file
   */
  private write(message: string, isError: boolean = false): void {
    if (isError) {
      process.stderr?.write(message + '\n');
    } else {
      process.stdout?.write(message + '\n');
    }
    
    // Also write to log file if configured
    if (this.logFile && typeof require !== 'undefined') {
      try {
        const fs = require('fs');
        fs.appendFileSync(this.logFile, message + '\n', { encoding: 'utf-8' });
      } catch (err) {
        // Silently fail if we can't write to file
      }
    }
  }

  /**
   * Log debug message
   */
  public debug(message: string, context?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.formatMessage(LogLevel.DEBUG, message, context);
      const colorized = this.colorizeMessage(formatted, LogLevel.DEBUG);
      this.write(colorized);
    }
  }

  /**
   * Log info message
   */
  public info(message: string, context?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.formatMessage(LogLevel.INFO, message, context);
      const colorized = this.colorizeMessage(formatted, LogLevel.INFO);
      this.write(colorized);
    }
  }

  /**
   * Log warning message
   */
  public warn(message: string, context?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.formatMessage(LogLevel.WARN, message, context);
      const colorized = this.colorizeMessage(formatted, LogLevel.WARN);
      this.write(colorized);
    }
  }

  /**
   * Log error message
   */
  public error(message: string, error?: Error | any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      let fullMessage = message;
      if (error) {
        if (error instanceof Error) {
          fullMessage += ` | ${error.message}`;
          if (error.stack) {
            fullMessage += `\n${error.stack}`;
          }
        } else {
          fullMessage += ` | ${String(error)}`;
        }
      }
      const formatted = this.formatMessage(LogLevel.ERROR, fullMessage);
      const colorized = this.colorizeMessage(formatted, LogLevel.ERROR);
      this.write(colorized, true);
    }
  }

  /**
   * Log dependency issue (special ERROR variant)
   * Used when a module, library, or service dependency fails
   */
  public dependencyIssue(moduleName: string, error: Error | any): void {
    if (this.shouldLog(LogLevel.DEPENDENCY_ISSUE)) {
      let errorMsg = '';
      if (error instanceof Error) {
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
      }
      const message = `Dependency Issue: ${moduleName} - ${errorMsg}`;
      const formatted = this.formatMessage(LogLevel.DEPENDENCY_ISSUE, message);
      const colorized = this.colorizeMessage(formatted, LogLevel.DEPENDENCY_ISSUE);
      this.write(colorized, true);
    }
  }

  /**
   * Log fatal error - should stop the service
   */
  public fatal(message: string, error?: Error | any): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      let fullMessage = message;
      if (error) {
        if (error instanceof Error) {
          fullMessage += ` | ${error.message}`;
          if (error.stack) {
            fullMessage += `\n${error.stack}`;
          }
        } else {
          fullMessage += ` | ${String(error)}`;
        }
      }
      const formatted = this.formatMessage(LogLevel.FATAL, fullMessage);
      const colorized = this.colorizeMessage(formatted, LogLevel.FATAL);
      this.write(colorized, true);
    }
  }

  /**
   * Set log level
   */
  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  public getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Create a child logger for a specific service
   */
  public forService(serviceName: string): Logger {
    return new Logger({
      serviceName,
      threadId: this.threadId,
      level: this.level,
      colorize: this.colorize,
      format: this.format,
      silent: this.silent,
    });
  }

  /**
   * Set thread ID (assigned by Bootstrap Manager)
   */
  public setThreadId(threadId: string): void {
    this.threadId = threadId;
  }

  /**
   * Silence all output
   */
  public silence(): void {
    this.silent = true;
  }

  /**
   * Resume output
   */
  public resume(): void {
    this.silent = false;
  }
}

/**
 * Default export - single global logger instance
 * Can be overridden by Bootstrap manager
 */
let globalLogger = new Logger({
  serviceName: process.env.SERVICE_NAME || 'nodejs-service',
  threadId: process.env.THREAD_ID || 'main',
  level: LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO,
  colorize: true,
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'text',
  silent: process.env.SILENT === 'true',
});

export const getGlobalLogger = (): Logger => globalLogger;
export const setGlobalLogger = (logger: Logger): void => {
  globalLogger = logger;
};

export default globalLogger;
