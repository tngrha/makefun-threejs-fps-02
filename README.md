# DUSTLINE — a three.js tactical FPS

A round-based tactical FPS in the style Counter-Strike made famous, but with
its own map, art, sounds and names. You attack alone against four defenders
on Yard 7, a desert freight yard: two lanes, a mid connector, and two bomb
sites — A, the crate yard, and B, the warehouse containers.

**The match:** first to 5 rounds (at most 9). A round is won by eliminating
the defence or by planting the bomb and letting it go off; it is lost when
you die, the clock runs out with no plant, or the defence defuses. Money is
earned per kill (+$300), per plant (+$300), per round win (+$2,200) and per
round loss (+$1,400), and spent between rounds in the buy menu (B).

**The arsenal:** P9 pistol (free), Hornet-9 SMG ($1,500), VK-47 rifle
($2,700), and the Spark grenade ($300, throw with G). Gunfire is hitscan
with headshots worth double, recoil and spread that punish firing on the
move, and crouching that steadies the aim.

**The bots:** four defenders that hold the sites, walk routes, react to
sight and sound (a gunshot pulls them to investigate), strafe while they
engage, converge to defuse a planted bomb — and move to check on a teammate
who goes down. A kill no longer leaves the rest of the defence walking its
routes unaware.

**Tech:** three.js 0.187.0 vendored under `game/vendor/three/`, plain ES
modules, no build step, no network, no assets — all sound is synthesized
with WebAudio. The simulation runs at a fixed 60 Hz apart from rendering.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

WASD move, mouse look, Click fire, R reload, Ctrl crouch, Space jump,
E plant the bomb (hold, inside a site), G throw a grenade, 1/2/3 buy or
switch weapons, B buy menu, Enter start the round early.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots are captured with `?shot=start|play|plant|end&seed=1` — see
`shots.json`. Entry for the make.fun threejs-fps-02 bounty.
