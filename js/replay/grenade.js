// Presentation-only history for the grenade camera. The simulation owns the projectile.
import * as THREE from '../../vendor/three/three.module.min.js?v=c833319-mwdf0xz1';

const SAMPLE_INTERVAL = 1 / 30;
const FLIGHT_LIMIT = 1.6;
const BLAST_HOLD = 1;

export class GrenadeReplay {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
    this.tracks = new Map();
    this.held = null;
    this.target = new THREE.Vector3();
    this.offset = new THREE.Vector3();
  }

  reset() {
    this.tracks.clear();
    this.release();
    this.marker?.removeFromParent();
  }

  release() { this.held = null; this.pending = null; }
  request(owner) { this.pending = { owner, id: null }; }
  accept(owner, id) { if (this.pending?.owner === owner) this.pending.id = id; }
  projectile(id) { return this.tracks.get(id)?.nade || null; }
  track(id) { return this.tracks.get(id); }
  hide() { if (this.marker) this.marker.visible = false; }

  record(nade, t) {
    const key = nade.id ?? nade;
    let track = this.tracks.get(key);
    if (!track) {
      track = { id: nade.id, samples: [], blast: null, latest: null, active: true };
      this.tracks.set(key, track);
    }
    track.nade = nade;
    const { x, y, z, vx, vy, vz } = nade;
    const speed = Math.hypot(vx, vy, vz);
    const direction = speed > 0.1 ? [vx / speed, vy / speed, vz / speed] : track.latest?.direction || [0, 0, -1];
    track.latest = { t, x, y, z, direction };
    const previous = track.samples.at(-1);
    if (!previous || t - previous.t >= SAMPLE_INTERVAL - 1e-6) track.samples.push(track.latest);
    return track;
  }

  sample(live, t) {
    if (!live.length && !this.tracks.size) return;
    const active = new Set(live.map(nade => nade.id ?? nade));
    for (const nade of live) {
      const track = this.record(nade, t);
      if (this.pending && this.pending.id === nade.id) { this.held = track; this.pending = null; }
    }
    for (const [key, track] of this.tracks) {
      track.active = active.has(key) && !track.blast;
      if (!track.active && t - (track.blast?.t ?? track.latest.t) > 6) {
        if (this.held === track) this.release();
        this.tracks.delete(key);
      }
    }
  }

  hold(nade, t) { this.held = this.record(nade, t); }

  explode(nade, t, position = nade) {
    const track = this.record(nade, t);
    const { x, y, z } = position;
    track.blast = { ...track.latest, x, y, z };
    track.active = false;
    return track;
  }

  duration(track) {
    return Math.max(0, Math.min(FLIGHT_LIMIT, track.blast.t - track.samples[0].t));
  }

  live(t, world) {
    const track = this.held;
    if (!track) return null;
    if (track.blast && t - track.blast.t < BLAST_HOLD) return this.place(track.blast, world);
    return track.active ? this.place(track.latest, world) : null;
  }

  replay(track, elapsed, scene, world) {
    const flight = this.duration(track);
    if (elapsed >= flight + BLAST_HOLD) return null;
    const { samples, blast } = track;
    if (elapsed >= flight) {
      this.showMarker(scene, blast, elapsed - flight);
      return this.place(blast, world);
    }
    const start = samples[0].t;
    const time = start + (blast.t - start) * Math.max(0, elapsed) / flight;
    const index = samples.findIndex(sample => sample.t > time);
    const next = index < 0 ? blast : samples[index];
    const prev = index < 0 ? samples.at(-1) : samples[Math.max(0, index - 1)];
    const weight = next.t > prev.t ? (time - prev.t) / (next.t - prev.t) : 0;
    const pose = {
      x: prev.x + (next.x - prev.x) * weight,
      y: prev.y + (next.y - prev.y) * weight,
      z: prev.z + (next.z - prev.z) * weight,
      direction: prev.direction,
    };
    this.showMarker(scene, pose);
    return this.place(pose, world);
  }

  place(pose, world) {
    this.target.set(pose.x, pose.y, pose.z);
    this.offset.fromArray(pose.direction).multiplyScalar(-1.5);
    this.offset.y += 0.4;
    const distance = this.offset.length();
    const direction = this.offset.clone().normalize().toArray();
    const wall = world?.raycast(this.target.toArray(), direction, distance);
    if (wall >= 0 && wall < distance) this.offset.multiplyScalar(Math.max(0.05, wall - 0.06) / distance);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
    return this.camera;
  }

  showMarker(scene, pose, blastAge) {
    if (!this.marker) {
      const geometry = new THREE.SphereGeometry(0.07, 10, 8);
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      this.marker = new THREE.Mesh(geometry, material);
    }
    const marker = this.marker;
    if (marker.parent !== scene) scene.add(marker);
    marker.visible = true;
    marker.position.set(pose.x, pose.y, pose.z);
    marker.material.color.setHex(blastAge === undefined ? 0x879756 : 0xffa044);
    marker.material.opacity = blastAge === undefined ? 1 : 0.85 * (1 - blastAge);
    marker.scale.setScalar(blastAge === undefined ? 1 : 2 + 12 * blastAge);
  }
}
