import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Date in the facility timezone, formatted YYYY-MM-DD.
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
}

export function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

export function localTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone, dateStyle: 'full', timeStyle: 'long',
  }).format(date);
}

export function logFilePath(date = new Date()) {
  return path.join(config.paths.logs, `publish-${localDate(date)}.log`);
}

// Collects lines for the current run so failure emails can include them.
export function createLogger(runId) {
  const lines = [];
  fs.mkdirSync(config.paths.logs, { recursive: true });
  const write = (level, message, extra) => {
    const detail = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    const line = `${new Date().toISOString()} [${level}] [${runId}] ${message}${detail}`;
    lines.push(line);
    fs.appendFileSync(logFilePath(), `${line}\n`);
    (level === 'ERROR' ? console.error : console.log)(line);
  };
  return {
    info: (message, extra) => write('INFO', message, extra),
    warn: (message, extra) => write('WARN', message, extra),
    error: (message, extra) => write('ERROR', message, extra),
    lines,
  };
}
