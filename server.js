const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));

// Use server.listen to listen on all interfaces for both HTTP and Socket.IO
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT} (or your LAN IP)`);
});

let balls = {};
const BALL_RADIUS = 20;
const GRAVITY = 0; // No downwards gravity
const FRICTION = 0.93; // Slow down physics
const canvasWidth = 4000;
const canvasHeight = 3000;
const dt = 0.25; // Slow down physics

const stars = [];
const powerUps = [];
const powerUpTypes = ["speed", "gravityBomb"];
const players = {};

// Add AI balls
const NUM_AIS = 8;
let aiBalls = {};
function spawnAIBall() {
    const id = 'ai_' + crypto.randomUUID();
    balls[id] = {
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        vx: 0,
        vy: 0,
        r: BALL_RADIUS,
        name: 'AI',
        score: 0,
        mass: BALL_RADIUS,
        speedBoost: false,
        ax: 0,
        ay: 0,
        isAI: true
    };
    aiBalls[id] = true;
}
for (let i = 0; i < NUM_AIS; i++) spawnAIBall();

// Give stars velocity and physics properties
function ensureStarPhysics(star) {
    if (star.vx === undefined) star.vx = (Math.random() - 0.5) * 2;
    if (star.vy === undefined) star.vy = (Math.random() - 0.5) * 2;
    if (star.r === undefined) star.r = 6;
}

function spawnStars(count = 10) {
    for (let i = 0; i < count; i++) {
        const star = {
            id: crypto.randomUUID(),
            x: Math.random() * canvasWidth,
            y: Math.random() * canvasHeight,
            r: 6,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2
        };
        stars.push(star);
    }
}

function spawnPowerUp() {
    const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
    powerUps.push({
        id: crypto.randomUUID(),
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        type,
    });
}

// Power-up interval
setInterval(spawnPowerUp, 5000);  // Spawn power-ups every 5 seconds

// Chaos event interval
setInterval(() => {
    const ids = Object.keys(balls);
    if (ids.length === 0) return;
    const chaosType = Math.random() > 0.5 ? "explosion" : "speedChange";
    const randomBall = balls[ids[Math.floor(Math.random() * ids.length)]];
    if (!randomBall) return;
    if (chaosType === "explosion") {
        randomBall.vx *= 2;
        randomBall.vy *= 2;
    } else {
        randomBall.vx = Math.random() * 10;
        randomBall.vy = Math.random() * 10;
    }
}, 30000);  // Every 30 seconds

// --- New Features Section ---

// Feature 1: Random wind gusts that affect all balls every 10 seconds
setInterval(() => {
    const windX = (Math.random() - 0.5) * 8;
    const windY = (Math.random() - 0.5) * 8;
    for (const id in balls) {
        balls[id].vx += windX;
        balls[id].vy += windY;
    }
}, 10000);

// Feature 4: Random "super star" that gives 5 points and a speed boost
let superStar = null;
function maybeSpawnSuperStar() {
    if (!superStar && Math.random() < 0.1) {
        superStar = {
            id: crypto.randomUUID(),
            x: Math.random() * canvasWidth,
            y: Math.random() * canvasHeight,
            r: 16
        };
    }
}
setInterval(maybeSpawnSuperStar, 4000);

// --- Spatial Hash Grid for collision optimization ---
class SpatialHashGrid {
    constructor(cellSize, width, height) {
        this.cellSize = cellSize;
        this.width = width;
        this.height = height;
        this.grid = {};
    }
    _hash(x, y) {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        return `${cx},${cy}`;
    }
    insert(obj, x, y, r) {
        const minX = Math.floor((x - r) / this.cellSize);
        const maxX = Math.floor((x + r) / this.cellSize);
        const minY = Math.floor((y - r) / this.cellSize);
        const maxY = Math.floor((y + r) / this.cellSize);
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cy = minY; cy <= maxY; cy++) {
                const key = `${cx},${cy}`;
                if (!this.grid[key]) this.grid[key] = [];
                this.grid[key].push(obj);
            }
        }
    }
    query(x, y, r) {
        const found = new Set();
        const minX = Math.floor((x - r) / this.cellSize);
        const maxX = Math.floor((x + r) / this.cellSize);
        const minY = Math.floor((y - r) / this.cellSize);
        const maxY = Math.floor((y + r) / this.cellSize);
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cy = minY; cy <= maxY; cy++) {
                const key = `${cx},${cy}`;
                if (this.grid[key]) {
                    for (const obj of this.grid[key]) {
                        found.add(obj);
                    }
                }
            }
        }
        return Array.from(found);
    }
    clear() {
        this.grid = {};
    }
}

// --- Orbital mechanics toggle (gravity toggle) ---
let orbitalMechanics = false;

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Give each new client a ball
    balls[socket.id] = {
        x: 100 + Math.random() * 400,
        y: 100,
        vx: 0,
        vy: 0,
        r: BALL_RADIUS,
        name: 'Anonymous',
        score: 0,
        mass: BALL_RADIUS,
        speedBoost: false,
        ax: 0,
        ay: 0
    };

    // Assign team and player info
    const team = Math.random() > 0.5 ? 'red' : 'blue';
    players[socket.id] = { team, x: balls[socket.id].x, y: balls[socket.id].y, score: 0, name: 'Anonymous' };

    socket.emit('init', { id: socket.id });

    socket.on('fling', ({ dx, dy }) => {
        const b = balls[socket.id];
        if (b) {
            // Make fling speed inversely proportional to mass (radius)
            const mass = b.r || BALL_RADIUS;
            const base = 200; // tuning constant for feel
            b.vx = -dx / (base + mass);
            b.vy = -dy / (base + mass);
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // --- Explode player into stars on disconnect ---
        const b = balls[socket.id];
        if (b) {
            // Use area as mass, and rStar = 6
            const rStar = 6;
            const area = Math.PI * b.r * b.r;
            const starArea = Math.PI * rStar * rStar;
            let numStars = Math.max(5, Math.floor(area / starArea));
            for (let i = 0; i < numStars; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = b.r + 10;
                const speed = 6 + Math.random() * 6;
                stars.push({
                    id: crypto.randomUUID(),
                    x: b.x + Math.cos(angle) * dist,
                    y: b.y + Math.sin(angle) * dist,
                    r: rStar,
                    vx: Math.cos(angle) * speed + (b.vx || 0) * 0.5,
                    vy: Math.sin(angle) * speed + (b.vy || 0) * 0.5
                });
            }
        }
        delete balls[socket.id];
        delete players[socket.id];
    });

    socket.on('setName', (name) => {
        if (balls[socket.id]) {
            balls[socket.id].name = name.slice(0, 20);
        }
        if (players[socket.id]) {
            players[socket.id].name = name.slice(0, 20);
        }
    });

    socket.on('chatMessage', (message) => {
        socket.broadcast.emit('chatMessage', { message, player: socket.id });
    });

    // Add chain/rope physics event
    socket.on('chain', (mouseWorld) => {
        const b = balls[socket.id];
        if (!b) return;
        // Simulate a spring/rope between ball and mouse
        const dx = mouseWorld.x - b.x;
        const dy = mouseWorld.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxLen = 180; // max rope length
        let tx = mouseWorld.x, ty = mouseWorld.y;
        if (dist > maxLen) {
            // Clamp to max rope length
            tx = b.x + dx * (maxLen / dist);
            ty = b.y + dy * (maxLen / dist);
        }
        // Spring force
        const k = 0.08; // spring constant (lower = softer)
        b.vx += (tx - b.x) * k * dt;
        b.vy += (ty - b.y) * k * dt;
    });

    socket.on('toggleOrbitalMechanics', (enabled) => {
        orbitalMechanics = !!enabled;
    });

    // Send initial state
    socket.emit("update", {
        balls,
        stars,
        powerUps,
        players
    });
});

// Improved AI logic: avoid other balls, seek stars, and avoid edges, but more aggressive
function aiStep() {
    for (const id in aiBalls) {
        const ball = balls[id];
        if (!ball) continue;

        // Find nearest star
        let nearestStar = null, minStarDist = Infinity;
        for (const star of stars) {
            const dx = star.x - ball.x;
            const dy = star.y - ball.y;
            const dist = dx * dx + dy * dy;
            if (dist < minStarDist) {
                minStarDist = dist;
                nearestStar = star;
            }
        }

        // Seek nearest player/ball (aggressive)
        let attackX = 0, attackY = 0;
        let nearestBall = null, minBallDist = Infinity;
        for (const oid in balls) {
            if (oid === id) continue;
            const other = balls[oid];
            const dx = other.x - ball.x;
            const dy = other.y - ball.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minBallDist) {
                minBallDist = dist;
                nearestBall = other;
            }
        }
        if (nearestBall && minBallDist < 600) { // Only attack if not too far
            const dx = nearestBall.x - ball.x;
            const dy = nearestBall.y - ball.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            // Move toward other ball more aggressively
            attackX = (dx / len) * 10;
            attackY = (dy / len) * 10;
        }

        // Avoid edges
        let edgeAvoidX = 0, edgeAvoidY = 0;
        const margin = 100;
        if (ball.x < margin) edgeAvoidX += (margin - ball.x) * 0.2;
        if (ball.x > canvasWidth - margin) edgeAvoidX -= (ball.x - (canvasWidth - margin)) * 0.2;
        if (ball.y < margin) edgeAvoidY += (margin - ball.y) * 0.2;
        if (ball.y > canvasHeight - margin) edgeAvoidY -= (ball.y - (canvasHeight - margin)) * 0.2;

        // Seek star
        let seekX = 0, seekY = 0;
        if (nearestStar) {
            const dx = nearestStar.x - ball.x;
            const dy = nearestStar.y - ball.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            seekX = (dx / len) * 6;
            seekY = (dy / len) * 6;
        }

        // Combine behaviors (aggressive: attack > seek star > avoid edge)
        let ax = attackX + seekX + edgeAvoidX;
        let ay = attackY + seekY + edgeAvoidY;

        // Add a little randomness
        ax += (Math.random() - 0.5) * 1.5;
        ay += (Math.random() - 0.5) * 1.5;

        // Simulate "fling" if not moving much
        if (Math.abs(ball.vx) + Math.abs(ball.vy) < 2) {
            ball.vx += ax * 0.7; // more aggressive
            ball.vy += ay * 0.7;
        }
    }
}

// Physics loop
setInterval(() => {
    // Power-up collision and effect
    for (const id in balls) {
        const ball = balls[id];

        for (let i = powerUps.length - 1; i >= 0; i--) {
            const powerUp = powerUps[i];
            const dx = powerUp.x - ball.x;
            const dy = powerUp.y - ball.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < (ball.r + 10) ** 2) {  // 10 is the power-up radius
                powerUps.splice(i, 1);  // Remove power-up from array

                // Apply power-up effect
                if (powerUp.type === "speed") {
                    ball.speedBoost = true;
                    setTimeout(() => { ball.speedBoost = false; }, 5000);  // 5 seconds boost
                } else if (powerUp.type === "gravityBomb") {
                    for (const otherId in balls) {
                        if (otherId !== id) {
                            const otherBall = balls[otherId];
                            const dx = otherBall.x - ball.x;
                            const dy = otherBall.y - ball.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            const force = (ball.mass * 5) / (dist * dist + 0.1);  // Gravity pull
                            otherBall.vx += force * dx;
                            otherBall.vy += force * dy;
                        }
                    }
                }
            }
        }
    }

    aiStep();

    // --- Super star logic ---
    if (superStar) {
        for (const id in balls) {
            const ball = balls[id];
            const dx = superStar.x - ball.x;
            const dy = superStar.y - ball.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < (ball.r + superStar.r) ** 2) {
                ball.score = (ball.score || 0) + 5;
                if (players[id]) players[id].score = ball.score;
                ball.speedBoost = true;
                setTimeout(() => { ball.speedBoost = false; }, 4000);
                superStar = null;
                break;
            }
        }
    }

    // --- Chain/rope physics for player ball when dragging ---
    for (const id in balls) {
        const b = balls[id];
        // Only apply to human players (not AI)
        if (!b.isAI && b.name !== 'Anonymous' && b.name) {
            b.attached = false;
        }
    }

    for (const id in balls) {
        const b = balls[id];

        b.vy += GRAVITY;
        b.vx *= FRICTION;
        b.vy *= FRICTION;

        b.x += b.vx;
        b.y += b.vy;

        // Bounce off walls
        if (b.x - b.r < 0) {
            b.x = b.r;
            b.vx *= -1;
        } else if (b.x + b.r > canvasWidth) {
            b.x = canvasWidth - b.r;
            b.vx *= -1;
        }

        // Bounce off floor/ceiling
        if (b.y + b.r > canvasHeight) {
            b.y = canvasHeight - b.r;
            b.vy *= -1;
        } else if (b.y - b.r < 0) {
            b.y = b.r;
            b.vy *= -1;
        }
    }
    physicsStep();
    io.emit('state', { balls, stars, powerUps, players, canvasWidth, canvasHeight, superStar });
}, 1000 / 60); // 60 FPS
spawnStars(10000);
// contributes to lag if too much is present
//setInterval(() => {
//    spawnStars();
//}, 5000);

function physicsStep() {
    // Reset acceleration
    for (const id in balls) {
        const b = balls[id];
        b.ax = 0;
        b.ay = 0;
    }

    // Basic gravity-like attraction (optional)
    if (orbitalMechanics) {
        const ids = Object.keys(balls);
        for (let i = 0; i < ids.length; i++) {
            const a = balls[ids[i]];
            for (let j = i + 1; j < ids.length; j++) {
                const b = balls[ids[j]];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distSq = dx * dx + dy * dy;
                const dist = Math.sqrt(distSq) + 0.1;

                const force = 1000 * a.r * b.r / (distSq + 1);
                const fx = force * dx / dist;
                const fy = force * dy / dist;

                a.ax += fx / a.r;
                a.ay += fy / a.r;
                b.ax -= fx / b.r;
                b.ay -= fy / b.r;
            }
        }
    }

    // Apply physics & wall bounce
    for (const id in balls) {
        const b = balls[id];
        // Ball radius grows with score: area = area of base + area of all collected stars
        // r = sqrt(r0^2 + score * r_star^2)
        const r0 = BALL_RADIUS;
        const rStar = 6;
        b.r = Math.sqrt(r0 * r0 + (b.score || 0) * rStar * rStar);
        b.hitboxRadius = b.r; // Ensure hitbox is always up-to-date

        b.vx += b.ax * dt;
        b.vy += b.ay * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Wall bounce
        if (b.x - b.r < 0) {
            b.x = b.r;
            b.vx *= -1;
        } else if (b.x + b.r > canvasWidth) {
            b.x = canvasWidth - b.r;
            b.vx *= -1;
        }
        if (b.y - b.r < 0) {
            b.y = b.r;
            b.vy *= -1;
        } else if (b.y + b.r > canvasHeight) {
            b.y = canvasHeight - b.r;
            b.vy *= -1;
        }
    }

    // --- Star physics: move, bounce off walls, and bounce off each other ---
    const STAR_DRAG = 0.98; // Add drag to stars (tweak as needed)
    const STAR_STATIC_THRESHOLD = 0.03; // Velocity below which star becomes static
    for (const star of stars) {
        ensureStarPhysics(star);
        // Only update physics if not static
        if (!star.static) {
            star.vx *= STAR_DRAG;
            star.vy *= STAR_DRAG;
            star.x += star.vx * dt;
            star.y += star.vy * dt;

            // Wall bounce
            if (star.x - star.r < 0) {
                star.x = star.r;
                star.vx *= -1;
            } else if (star.x + star.r > canvasWidth) {
                star.x = canvasWidth - star.r;
                star.vx *= -1;
            }
            if (star.y - star.r < 0) {
                star.y = star.r;
                star.vy *= -1;
            } else if (star.y + star.r > canvasHeight) {
                star.y = canvasHeight - star.r;
                star.vy *= -1;
            }

            // If velocity is very low, make static
            if (Math.abs(star.vx) < STAR_STATIC_THRESHOLD && Math.abs(star.vy) < STAR_STATIC_THRESHOLD) {
                star.vx = 0;
                star.vy = 0;
                star.static = true;
            }
        }
    }

    // --- Optimized star-star collision using spatial hash ---
    const starCellSize = 32;
    const starGrid = new SpatialHashGrid(starCellSize, canvasWidth, canvasHeight);
    for (const star of stars) {
        starGrid.insert(star, star.x, star.y, star.r);
    }
    for (let i = 0; i < stars.length; i++) {
        const a = stars[i];
        if (a.static) continue; // Skip static stars for collision
        const neighbors = starGrid.query(a.x, a.y, a.r + 8);
        for (const b of neighbors) {
            if (a === b || b.static) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = a.r + b.r;
            if (dist < minDist && dist > 0) {
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = (minDist - dist) / 2;
                a.x -= nx * overlap;
                a.y -= ny * overlap;
                b.x += nx * overlap;
                b.y += ny * overlap;
                const dvx = b.vx - a.vx;
                const dvy = b.vy - a.vy;
                const dot = dvx * nx + dvy * ny;
                if (dot < 0) {
                    const impulse = dot;
                    a.vx += nx * impulse;
                    a.vy += ny * impulse;
                    b.vx -= nx * impulse;
                    b.vy -= ny * impulse;
                    // If either was static, wake both up
                    if (a.static) a.static = false;
                    if (b.static) b.static = false;
                }
            }
        }
    }
    starGrid.clear();

    // Occasionally give random stars a little push to keep them moving
    if (Math.random() < 0.05) {
        const s = stars[Math.floor(Math.random() * stars.length)];
        if (s && s.static) {
            s.static = false;
            s.vx += (Math.random() - 0.5) * 2;
            s.vy += (Math.random() - 0.5) * 2;
        }
    }

    // --- Optimized ball-ball collision using spatial hash ---
    const ballCellSize = 64;
    const ballGrid = new SpatialHashGrid(ballCellSize, canvasWidth, canvasHeight);
    const ballIds = Object.keys(balls);
    for (const id of ballIds) {
        const b = balls[id];
        // Use b.r for hitbox
        ballGrid.insert(b, b.x, b.y, b.r);
    }
    // Only check each pair once
    const checkedPairs = new Set();
    for (const id of ballIds) {
        const a = balls[id];
        const neighbors = ballGrid.query(a.x, a.y, a.r + 40);
        for (const b of neighbors) {
            if (a === b) continue;
            // Use socket id as unique identifier for pairKey
            const pairKey = id < b.id ? id + "|" + b.id : b.id + "|" + id;
            if (checkedPairs.has(pairKey)) continue;
            checkedPairs.add(pairKey);

            // Use up-to-date radii for collision
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const rA = a.r || BALL_RADIUS;
            const rB = b.r || BALL_RADIUS;
            const overlap = rA + rB - dist;

            if (overlap > 0) {
                const nx = dx / (dist || 1e-8);
                const ny = dy / (dist || 1e-8);

                // --- Physically correct ELASTIC collision with different masses ---
                // Use mass proportional to area (r^2)
                const massA = rA * rA;
                const massB = rB * rB;

                // Relative velocity in normal direction
                const relVel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

                // Coefficient of restitution (bounciness)
                const restitution = 2;

                if (relVel < 0) {
                    // 1D elastic collision equations for normal velocity with restitution
                    const vA_n = (a.vx * nx + a.vy * ny);
                    const vB_n = (b.vx * nx + b.vy * ny);

                    // Elastic collision with restitution
                    const vA_n_after = (
                        (massA * vA_n + massB * vB_n + massB * restitution * (vB_n - vA_n))
                        / (massA + massB)
                    );
                    const vB_n_after = (
                        (massA * vA_n + massB * vB_n + massA * restitution * (vA_n - vB_n))
                        / (massA + massB)
                    );

                    // Tangential velocities remain unchanged
                    const tx = -ny, ty = nx;
                    const vA_t = a.vx * tx + a.vy * ty;
                    const vB_t = b.vx * tx + b.vy * ty;

                    // Update velocities (with restitution)
                    a.vx = vA_n_after * nx + vA_t * tx;
                    a.vy = vA_n_after * ny + vA_t * ty;
                    b.vx = vB_n_after * nx + vB_t * tx;
                    b.vy = vB_n_after * ny + vB_t * ty;
                }

                // Separate them
                const separation = overlap / 2;
                a.x -= separation * nx;
                a.y -= separation * ny;
                b.x += separation * nx;
                b.y += separation * ny;

                // --- Eject stars inversely proportional to speed and mass ---
                const eject = (ball) => {
                    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    const mass = ball.r;
                    // Inverse proportionality: higher speed = less star loss, lower speed = more star loss
                    // Clamp speed to avoid division by zero and excessive loss at very low speeds
                    const minSpeed = 1;
                    const maxLoss = 10; // maximum stars lost at lowest speed
                    const lossFactor = Math.max(minSpeed, speed);
                    let ejectCount = Math.floor((mass / lossFactor));
                    ejectCount = Math.min(ejectCount, maxLoss);
                    if (ejectCount > 0 && (ball.score || 0) > 0) {
                        ejectCount = Math.min(ejectCount, ball.score);
                        for (let k = 0; k < ejectCount; k++) {
                            const angle = Math.random() * Math.PI * 2;
                            const dist = ball.r + 10;
                            const ejectSpeed = 8 + speed * 0.5;
                            stars.push({
                                id: crypto.randomUUID(),
                                x: ball.x + Math.cos(angle) * dist,
                                y: ball.y + Math.sin(angle) * dist,
                                r: 6,
                                vx: Math.cos(angle) * ejectSpeed + ball.vx * 0.3,
                                vy: Math.sin(angle) * ejectSpeed + ball.vy * 0.3
                            });
                        }
                        ball.score -= ejectCount;
                        if (players[ball.id]) players[ball.id].score = ball.score;
                    }
                };
                eject(a);
                eject(b);
            }
        }
    }
    ballGrid.clear();

    // --- Star collection (optimized) ---
    // Use spatial hash for star collection
    const starCollectGrid = new SpatialHashGrid(64, canvasWidth, canvasHeight);
    for (const star of stars) {
        starCollectGrid.insert(star, star.x, star.y, star.r);
    }
    for (const id in balls) {
        const ball = balls[id];
        const possibleStars = starCollectGrid.query(ball.x, ball.y, ball.r + 8);
        for (let i = stars.length - 1; i >= 0; i--) {
            const star = stars[i];
            if (!possibleStars.includes(star)) continue;
            const dx = star.x - ball.x;
            const dy = star.y - ball.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < (ball.r + star.r) ** 2) {
                stars.splice(i, 1); // Remove star
                ball.score = (ball.score || 0) + 1;
                if (players[id]) players[id].score = ball.score;
            }
        }
    }
    starCollectGrid.clear();
}

