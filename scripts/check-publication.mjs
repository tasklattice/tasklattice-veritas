import {execFileSync} from 'node:child_process';

// Scan staged bytes, not working-tree files. Never print a matched credential.
const git = (...args) => execFileSync('git', args, {maxBuffer: 32 * 1024 * 1024});
const files = git('ls-files', '--cached', '-z').toString().split('\0').filter(Boolean);
if (!files.length) {
  console.error('No files in the Git index. Stage the intended sources before running this check.');
  process.exit(1);
}
const forbidden = [
  /^(?:data|runs|node_modules|dist|build|coverage|logs|test-results|playwright-report|\.cache|\.promptfoo|\.taste-skill|\.venv|venv)\//,
  /^docs\/screenshots\//,
  /(?:^|\/)\.env(?:\..*)?$/, /(?:^|\/)\.npmrc$/,
  /(?:^|\/)__pycache__\//, /\.(?:pyc|pyo|pem|key|p12|pfx|log|tsbuildinfo)$/i,
  /^examples\/tali-local\.target\.json$/,
];
const rules = [
  ['Guard credential', /\btg_[A-Za-z0-9_-]{24,}/g],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{20,}/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['Model API key', /\b(?:nvapi-|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{24,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['Slack token', /\bxox[bapres]-[A-Za-z0-9-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['Workstation home path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//g],
  ['Concrete Guard Endpoint ID', /(?:endpoints\/|endpointId=)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g],
];
const failures = [];
for (const file of files) {
  if (file !== '.env.example' && forbidden.some(pattern => pattern.test(file))) failures.push(`${file}: excluded runtime, credential, or capture file`);
  const bytes = git('show', ':' + file);
  if (bytes.length > 10 * 1024 * 1024) failures.push(`${file}: unexpected file larger than 10 MiB`);
  const text = bytes.toString('utf8');
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      failures.push(`${file}:${line}: ${name} (value withheld)`);
    }
  }
}
if (failures.length) {
  console.error('Publication check failed:\n' + failures.map(f => '- ' + f).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Publication check passed: ${files.length} indexed files; no blocked paths or configured secret patterns found.`);
}
