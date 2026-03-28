import { spawn } from 'node:child_process';
import { config } from './config';
export function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false
        });
        let stdout = '';
        let stderr = '';
        let timeoutId;
        if (options.timeoutMs) {
            timeoutId = setTimeout(() => {
                child.kill('SIGKILL');
            }, options.timeoutMs);
        }
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', (error) => {
            if (timeoutId)
                clearTimeout(timeoutId);
            reject(error);
        });
        child.on('close', (code) => {
            if (timeoutId)
                clearTimeout(timeoutId);
            if (code === 0) {
                resolve({ stdout, stderr, code });
                return;
            }
            const error = new Error(`Command failed (${command} ${args.join(' ')}): ${stderr || stdout}`);
            error.stdout = stdout;
            error.stderr = stderr;
            error.code = code;
            reject(error);
        });
        if (options.input) {
            child.stdin.write(options.input);
            child.stdin.end();
        }
    });
}
export function runOpenClaw(args, options = {}) {
    return runCommand(config.openclawBin, args, Object.assign(Object.assign({}, options), { cwd: options.cwd || config.openclawStateDir || process.cwd() }));
}
export function runClawdbot(args, options = {}) {
    return runCommand(config.clawdbotBin, args, Object.assign(Object.assign({}, options), { cwd: options.cwd || config.openclawStateDir || process.cwd() }));
}
