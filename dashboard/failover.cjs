const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: pause } = require('node:timers/promises');

const repo = path.resolve(__dirname, '..');
const composeFile = path.join(repo, 'docker-compose.yml');
const backends = ['backend-1', 'backend-2'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const runFile = promisify(execFile);
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const blocked = 'Demo failover đang diễn ra. Hãy khôi phục backend và kiểm tra phục hồi.';

function markers(root) {
  const key = createHash('sha256').update(keyPath(root)).digest('hex').slice(0, 24);
  const base = path.join(os.tmpdir(), 'lb-lab-' + key);
  return { lease: base + '.failover', operation: base + '.docker-operation' };
}
async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function failoverBlocksBenchmark(root) {
  const { lease, operation } = markers(root);
  return await exists(lease) || await exists(operation);
}
async function assertNoFailover(root) {
  if (await failoverBlocksBenchmark(root)) throw fail(409, blocked);
}

function createDockerAdapter(run = runFile) {
  const endpoints = process.platform === 'win32'
    ? ['npipe:////./pipe/dockerDesktopLinuxEngine', 'npipe:////./pipe/docker_engine']
    : ['unix:///var/run/docker.sock'];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DOCKER_/i.test(key)));
  const inspected = new Map();
  async function command(endpoint, args) {
    return run('docker', ['--host', endpoint, ...args], {
      cwd: repo, env, shell: false, windowsHide: true, timeout: 8000, maxBuffer: 256 * 1024,
    });
  }
  return {
    async inspect(name) {
      if (!backends.includes(name)) throw fail(400, 'Backend không hợp lệ.');
      let missing = false;
      for (const endpoint of endpoints) {
        let response;
        try { response = await command(endpoint, ['container', 'inspect', name]); }
        catch (error) {
          if (error.code === 'ENOENT') break;
          if (/No such (object|container)/i.test(error.stderr || '')) missing = true;
          continue;
        }
        try {
          const container = JSON.parse(response.stdout)[0];
          if (!container?.Id) throw Error('Missing container ID');
          inspected.set(name, { id: container.Id, endpoint });
          return container;
        } catch { throw fail(503, 'Không đọc được trạng thái Docker.'); }
      }
      if (missing) return null;
      throw fail(503, 'Không truy cập được Docker cục bộ. Kiểm tra Docker Desktop và Docker CLI trong PATH.');
    },
    async change(action, id) {
      if (!/^[a-f0-9]{64}$/.test(id) || !['stop', 'start'].includes(action)) throw fail(400, 'Backend không hợp lệ.');
      const target = [...inspected.values()].find(entry => entry.id === id);
      if (!target) throw fail(409, 'Backend không hợp lệ.');
      const flags = action === 'stop' ? ['--time', '3'] : [];
      try { await command(target.endpoint, ['container', action, ...flags, id]); }
      catch { throw fail(503, 'Docker chưa xác nhận thao tác. Làm mới trạng thái trước khi tiếp tục.'); }
    },
  };
}

function validateContainer(container, name) {
  const labels = container?.Config?.Labels || {};
  const project = labels['com.docker.compose.project'];
  const workingDirectory = labels['com.docker.compose.project.working_dir'];
  const configFiles = labels['com.docker.compose.project.config_files'];
  if (container?.Name !== '/' + name || !/^[a-f0-9]{64}$/.test(container.Id) ||
      labels['com.docker.compose.service'] !== name || !project ||
      !workingDirectory || keyPath(workingDirectory) !== keyPath(repo) ||
      !configFiles || keyPath(configFiles) !== keyPath(composeFile)) {
    throw fail(409, 'Container không thuộc cấu hình Docker Compose của dự án.');
  }
  return project;
}

function createFailover({ root, docker = createDockerAdapter(), probe, targets, benchmarkBusy, demoBusy, delay = pause }) {
  const { lease, operation } = markers(root);
  const lock = path.join(root, '.benchmark.lock');
  let busy = false;
  const active = () => busy;
  const guarded = async work => {
    if (busy) throw fail(409, 'Một thao tác failover đang chạy.');
    busy = true;
    let handle;
    try {
      try { handle = await fs.open(operation, 'wx'); }
      catch (error) {
        if (error.code === 'EEXIST') throw fail(409, 'Một thao tác failover đang chạy hoặc còn khóa phiên bị ngắt.');
        throw error;
      }
      return await work();
    } finally {
      try { if (handle) { await handle.close(); await fs.unlink(operation); } }
      finally { busy = false; }
    }
  };
  async function inspect(name) {
    const container = await docker.inspect(name);
    return container ? { container, project: validateContainer(container, name) } : null;
  }
  const stable = entry => entry?.container.State?.Status === 'running' &&
    entry.container.State.Running === true && !entry.container.State.Paused && !entry.container.State.Restarting;
  const stopped = entry => ['exited', 'created'].includes(entry?.container.State?.Status) &&
    entry.container.State.Running === false;
  const responds = (result, name) => result.status === 200 && !result.error && result.backend === name;
  async function readState(balancer) {
    const httpChecks = Promise.all([probe(targets[balancer]), ...backends.map(name => probe(targets[name]))]);
    const dockerChecks = Promise.all(backends.map(async name => {
      try {
        const entry = await inspect(name);
        const state = entry?.container.State;
        return { name, docker: state?.Status || 'missing', containerHealth: state?.Health?.Status || null };
      } catch (error) {
        return { name, docker: 'unknown', containerHealth: null, error: error.message };
      }
    }));
    const [checks, containers] = await Promise.all([httpChecks, dockerChecks]);
    return { checkedAt: new Date().toISOString(), balancer, http: checks[0],
      backends: containers.map((container, i) => ({ ...container, http: checks[i + 1] })), session: await exists(lease),
      benchmarkBusy: benchmarkBusy() || await exists(lock) };
  }
  const snapshots = new Map();
  function state(balancer, fresh = false) {
    if (fresh) return readState(balancer);
    if (!snapshots.has(balancer)) {
      snapshots.set(balancer, readState(balancer).finally(() => snapshots.delete(balancer)));
    }
    return snapshots.get(balancer);
  }
  async function stop(name) {
    return guarded(async () => {
      if (benchmarkBusy() || demoBusy()) throw fail(409, 'Đang có benchmark hoặc demo thuật toán chạy.');
      const other = backends.find(id => id !== name);
      const [target, peer, response] = await Promise.all([inspect(name), inspect(other), probe(targets[other])]);
      if (!stable(target) || !stable(peer) || target.project !== peer.project || !responds(response, other)) {
        throw fail(409, 'Cần hai container đang chạy và backend còn lại phải trả lời HTTP hợp lệ.');
      }
      let handle;
      try { handle = await fs.open(lease, 'wx'); }
      catch (error) { if (error.code === 'EEXIST') throw fail(409, blocked); throw error; }
      await handle.close();
      // Both benchmark runners check the lease after acquiring their existing lock.
      if (benchmarkBusy() || demoBusy() || await exists(lock)) {
        await fs.unlink(lease);
        throw fail(409, 'Đang có benchmark hoặc demo thuật toán chạy.');
      }
      // Keep the lease if Docker times out: a stop may still have taken effect.
      await docker.change('stop', target.container.Id);
    });
  }
  async function restore(name) {
    return guarded(async () => {
      const target = await inspect(name);
      if (stable(target)) return;
      if (!stopped(target)) throw fail(409, 'Chỉ có thể khôi phục container đã dừng của dự án.');
      await docker.change('start', target.container.Id);
    });
  }
  async function checkRecovery() {
    return guarded(async () => {
      const entries = await Promise.all(backends.map(inspect));
      const checks = await Promise.all(backends.map(name => probe(targets[name])));
      if (!entries.every(stable) || entries[0].project !== entries[1].project ||
          !checks.every((result, i) => responds(result, backends[i]))) {
        throw fail(409, 'Hai backend chưa cùng phản hồi HTTP hợp lệ sau phục hồi.');
      }
      try { await fs.unlink(lease); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    });
  }
  async function requests(balancer, count, signal) {
    return guarded(async () => {
      if (benchmarkBusy() || demoBusy() || await exists(lock)) throw fail(409, 'Đang có benchmark hoặc demo thuật toán chạy.');
      const rows = [];
      for (let number = 1; number <= count; number++) {
        signal?.throwIfAborted();
        rows.push({ number, ...await probe(targets[balancer]) });
        if (number < count) await delay(150, undefined, { signal });
      }
      return rows;
    });
  }
  return { state, stop, restore, checkRecovery, requests, active };
}

module.exports = { createDockerAdapter, createFailover, assertNoFailover, failoverBlocksBenchmark, markers, blocked };
