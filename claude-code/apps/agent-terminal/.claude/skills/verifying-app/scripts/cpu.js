// CPU seconds and memory of the app's processes over a period, by process
// type (main, renderer, gpu-process, ...). Linux only (/proc).
//   node cpu.js [seconds=30]
// Run it while the app is in the state to measure (idle, preview open, ...).
const fs = require('fs');
const USER_HZ = 100; // /proc/<pid>/stat time unit
function sample() {
  const by = {};
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (!cmd.includes('agent-terminal/node_modules/electron/dist/electron')) continue;
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ');
      const type = (/--type=([a-z-]+)/.exec(cmd) || [, 'main'])[1];
      const rss = Number(fs.readFileSync(`/proc/${p}/statm`, 'utf8').split(' ')[1]) * 4096;
      by[type] = by[type] || { cpu: 0, rss: 0 };
      by[type].cpu += (Number(st[11]) + Number(st[12])) / USER_HZ;
      by[type].rss += rss;
    } catch { /* the process ended meanwhile */ }
  }
  return by;
}
const secs = Number(process.argv[2] || 30);
const a = sample();
if (!Object.keys(a).length) { console.error('app not running (scripts/launch.sh)'); process.exit(1); }
setTimeout(() => {
  const b = sample();
  for (const k of Object.keys(b)) {
    const cpu = b[k].cpu - (a[k] ? a[k].cpu : 0);
    console.log(`${k.padEnd(12)} cpu ${cpu.toFixed(2)} s / ${secs} s (${((cpu / secs) * 100).toFixed(1)}% of a core)  rss ${Math.round(b[k].rss / 1048576)} MB`);
  }
}, secs * 1000);
