# Proposal: occlusion-aware proximity voice (walls, floors, materials)

## Why

Roleplay servers need proximity voice that respects buildings. Today a player upstairs in a tavern hears every
word said in the cellar, and a conversation behind a closed door carries as if the door were not there. Distance
tiers (whisper / normal / shout) cannot fix this, because the problem is geometry, not range.

## What we found (KCDC 1.7.3, MafiaHub Framework `main` as of 2026-10-30)

Details and sources: [FINDINGS.md](FINDINGS.md).

- `VoiceRouter` relays purely by distance, virtual world and mute state. There is no script hook into the relay
  decision.
- The built-in mixer (`mixer.cpp`) does distance rolloff plus constant-power pan. KCDC renders voice through the
  game's FMOD instead (`IVoiceSink`; `KCDCClient.dll` contains the log line "FMOD refused a voice channel; leaving voice on the
  framework's own device"), but no occlusion or filter is applied.
- KCDC already traces for nametags ("KCDC Nametag occlusion ray").
- The game ships everything needed to do it the way its own sounds do it:
  - `Libs/MaterialEffects/SurfaceTypes.xml` gives every surface a `sound_obstruction` (wood 0.1, wooden door 0.15,
    rock / thatch / metal door 0.2, plaster / wicker 0.3, soil / terrain 0.6, stairs 0.05, cloth / metal 0);
  - `Libs/GameAudio/default_controls.xml` declares the ATL switch `ObstrOcclCalcType` with `Ignore`, `SingleRay`
    and `MultiRay`, and `g_rtpcs.xml` maps the results to FMOD parameters `obstruction` and `occlusion`.
- The only per-pair lever a script has today is server-side `Voice.setLocalMute(listener, talker)`. It is binary, so
  scripts can cut voice across floors, but they cannot muffle it.

## Proposed design

Two layers: a generic one in the open-source Framework that any MafiaHub game benefits from, and a game-specific
occlusion provider in KCDC that uses what the engine already knows.

### Layer 1 – Framework (generic, open source)

1. **Per-speaker acoustics in the world snapshot.** Extend `SpeakerPlacement` (or add `SpeakerAcoustics` beside it):

   ```cpp
   struct SpeakerAcoustics {
       float occlusion = 0.0f;   // 0 = clear line, 1 = fully blocked direct path
       float lowpassHz = 0.0f;   // 0 = no filter; otherwise cutoff the sink should apply
   };
   ```

   `IVoiceSink::PublishWorld` passes it through. The built-in mixer applies `gain *= 1 - occlusion * kOcclusionGain`
   and a one-pole low-pass per speaker slot (a few multiplies per sample, state per slot), so games without their own
   audio engine get it too.

2. **Occlusion provider interface** on `VoiceClient`, implemented by the game:

   ```cpp
   class IVoiceOcclusionProvider {
     public:
       virtual ~IVoiceOcclusionProvider() = default;
       // Main thread. Asynchronous engines return the last completed result and queue a new query.
       virtual SpeakerAcoustics Query(uint64_t speaker, const ListenerTransform &listener, const glm::vec3 &mouth) = 0;
   };
   ```

   `VoiceClient` calls it only for speakers that are currently audible (at most `kMaxAudibleTalkers`), round-robin,
   with a per-frame budget (e.g. 2 speakers per frame, each speaker refreshed at ≥ 8 Hz), and smooths the result
   (attack ~80 ms, release ~200 ms) so doors opening do not click.

3. **Occlusion also shortens reach.** Treat occlusion as extra distance:
   `effectiveDistance = distance + occlusion * occlusionPenaltyMeters`. A whisper behind a wall disappears, a shout
   gets through muffled. Done in the mixer, so relay bandwidth does not change.

4. **Script API.**

   ```ts
   // client
   Voice.setOcclusionEnabled(enabled: boolean): void;
   Voice.getSpeakerOcclusion(player: Player): number;               // for HUD / reach previews
   Voice.setSpeakerOcclusion(player: Player, value: number | null): void; // resource override, null = engine value
   // server (replicated to clients like tier ranges)
   Voice.setOcclusionModel(model: {
     enabled?: boolean;
     penaltyMeters?: number;          // extra distance at occlusion 1, default ~20
     materialScale?: number;          // multiplies vanilla sound_obstruction for voice, default ~3
     floorPenalty?: number;           // extra occlusion per horizontal surface crossed, default ~0.5
     strict?: boolean;                // see "Cheating" below
   }): void;
   Voice.setLocalVolume(listener: Entity, target: Entity, gain: number): void; // graded sibling of setLocalMute
   ```

   `setLocalVolume` is useful on its own (rooms, radio, stage microphones), and it gives server-authoritative
   attenuation when needed.

### Layer 2 – KCDC occlusion provider (game side)

**Evidence that the engine computes this for speech already** (KCD2 retail, `WHGame.dll` and `Scripts.pak`):

- `CPropagationProcessor`, the enum `EAudioObjectObstructionCalcType` (`eAOOCT_Ignore`, `eAOOCT_SingleRay`,
  `eAOOCT_MultiRay`), `CEntityAudioProxy::SetAudioObstructionCalcType` (also bound to Lua) and the cvars
  `s_OcclusionMaxDistance`, `s_FullObstructionMaxDistance`, `s_OcclusionDistanceHysteresis`,
  `wh_s_OcclusionRayEnabled`, `wh_s_OcclusionSmoothFloatDefaultAlpha`, `wh_s_ObstructionSmoothFloatDefaultAlpha`.
- `Scripts/Entities/AI/NPC.lua` and `NPC_Female.lua` set `eiSoundObstructionType = 2` (SingleRay) on every NPC.
  `Scripts/Utils/AudioUtils.lua` applies it through the switch `ObstrOcclCalcType` on the entity's default aux proxy.
- **Game code reads the computed occlusion of a speaking NPC:** `wh_s_OcclusionBubbleThreshold` ("Hide text bubbles
  when occlusion is above this value. See also sound_obstruction in SurfaceTypes.xml"),
  `wh_s_OcclusionBubbleThresholdEnable` and `wh_s_OcclusionRayNPCVerticalOffset`. Following the cross-references of
  these cvars in `WHGame.dll` leads to the function that reads an audio object's occlusion.
- NPC speech plays through `event:/voice/dialog/bark_010` … `bark_200`, `bark_inner`, `dialog` and `cinematic`, the same
  host events KCDC's `Audio.playFile(file, entityId, purpose)` already uses.

**Option A0, preferred: play voice as a native speech line.** KCDC already feeds files into the bark host events. Feed
live voice the same way: in the event's `FMOD_STUDIO_EVENT_CALLBACK_CREATE_PROGRAMMER_SOUND`, hand FMOD a user stream
(`FMOD_OPENUSER | FMOD_CREATESTREAM | FMOD_LOOP_NORMAL`, mono PCM16 48 kHz, `pcmreadcallback` reading the speaker's
playout buffer, small `decodebuffersize` such as 20 ms), play the event on the speaker's entity with
`ObstrOcclCalcType` = SingleRay or MultiRay, and choose the bark event closest to the speaker's range (whisper →
`bark_010`, normal → `bark_020`/`035`, shout → `bark_050`/`100`). Voice then gets the game's own occlusion, material
response, distance curve and reverb zones, plus the bubble logic. The framework keeps relaying by distance. In this
path the sink applies no gain of its own, and the occlusion arrives through the same `occlusion` RTPC that drives NPC
speech. A one-client test of exactly this path is described below ([`probe/`](probe/)).

**Option A, if a programmer stream is impractical: read the value and apply it to the existing channel.** Keep voice on
the core FMOD channels KCDC uses today. Give each audible speaker's entity proxy `ObstrOcclCalcType` = MultiRay, read
the occlusion the engine computes (the same read the speech-bubble code does), and apply it with
`FMOD::Channel::set3DOcclusion(direct, reverb)` or a low-pass DSP on the channel.

**Option B, if the ATL values are not readable: the same computation directly.**

- Async `IPhysicalWorld::RayWorldIntersection` (the queue the nametag ray already uses) from the listener's ears to
  the speaker's mouth; `ent_static | ent_terrain | ent_rigid | ent_sleeping_rigid`, pierceable so one ray reports
  several hits.
- For each hit, add `ISurfaceType::GetPhyscalParams().sound_obstruction × materialScale`. Closed `AnimDoor`s are
  physicalised with `mat_door_wood` / `mat_door_metal`, and an open door has swung out of the ray, so doors work
  without special cases.
- Multi-ray like CryEngine's propagation processor: a centre ray plus 4 rays offset ~0.4 m around the mouth.
  Partly blocked = obstruction (mild low-pass), all blocked = occlusion (strong low-pass and gain drop).
- Floors and ceilings: a hit whose normal is within ~45° of vertical, lying between the two heads and not on a stairs
  surface, adds `floorPenalty`.
- Map to FMOD: `direct = clamp(sum)`, `reverb = direct * 0.5`, cutoff ≈ `22000 * (1 - direct)^2`, minimum ~600 Hz.

**Optional diffraction (sound around corners and through open doors).** The server already has the level navmesh
(`Navigation.findPath(..., { doors: "open" })`). A route through open doors that is barely longer than the straight
line can cap occlusion (`occlusion = min(rayOcclusion, f(pathLength / distance))`). If the game's interiors use
VisAreas/portals, "different area, no open portal between them" is an even cheaper room test.

**Cost.** At most `kMaxAudibleTalkers` speakers × 5 rays × ~8 Hz, only while they are audible: a few hundred async
rays per second at the very worst, far fewer in practice.

### Smoothness and crowds

Framework facts this has to fit (`voice_config.h`): Opus 40 kbps in 20 ms frames, an adaptive jitter buffer of
2–10 frames (40–200 ms), recipients recomputed every 250 ms, and at most `kMaxAudibleTalkers = 6` mixed per client
(12 decoders).

- **Ray cost does not grow with the crowd.** Occlusion is needed only for the ≤ 6 talkers a client actually plays:
  ≤ 6 × 5 rays × 8 Hz ≈ 240 async rays/s at worst. The engine already traces every speaking NPC in a market square.
- **Slot choice must use occluded distance.** Today the 6 slots go to the nearest talkers. With occlusion they should
  go to the loudest after occlusion, otherwise a muffled voice behind a wall takes the slot of someone standing in
  front of you.
- **Bandwidth is the real crowd limit, and occlusion can lower it.** It costs 5 KB/s per talker per listener: 10 people
  talking at once in a tavern of 50 is ≈ 2.4 MB/s (≈ 20 Mbit/s) upstream from the server, with or without occlusion.
  If the server stops relaying pairs reported as fully occluded (strict mode below), floors and walls cut that traffic.
- **No clicks when occlusion changes.** Smooth the value (attack ~80 ms, release ~200 ms, as the engine does with
  `wh_s_OcclusionSmoothFloatDefaultAlpha`) and use FMOD's own occlusion or a filter parameter, never a volume jump.
- **A0-specific risks:**
  - keep one event instance per speaker slot alive across the pauses between words (VAD sends nothing in silence)
    and feed silence instead of restarting the event per word;
  - `pcmreadcallback` runs on FMOD's stream thread and must never block or run dry: read from the existing jitter
    buffer, return silence on underrun;
  - keep `decodebuffersize` small (≈ 20 ms), so the stream adds one frame of latency, not FMOD's default ~400 ms;
  - check the **max instances / stealing** settings of the `bark_0XX` events in the game's FMOD project: six player
    voices must not steal NPC lines or each other. If they are tight, use `dialog` or a dedicated event;
  - FMOD may virtualise a quiet, heavily occluded voice. That is the desired result, but test it for audible pops.
- **Option A has none of these risks.** The stream path stays as it is and only occlusion or a filter is applied to the
  existing channel. If A0 turns out fiddly, A is the safe fallback.

### Third-person camera: hear from the character, not the camera

With `Camera.setThirdPerson` the camera can sit up to 20 m behind the body, around a corner, or above a ceiling.
Relay is already decided by the server from body positions, but loudness, pan and occlusion on the client follow
whatever the listener is.

- **Framework already has the field:** `ListenerTransform::attenuationPosition` ("a third-person game puts the camera
  in `position` and the character here"). KCDC should fill it with the local character's head whenever the camera is
  not in first person.
- **FMOD path (A0 or game sounds generally):** FMOD Studio has the same split,
  `Studio::System::setListenerAttributes(listener, attributes, attenuationposition)`. Set `attenuationposition` to the
  character's head. Simpler and also right for occlusion: in third person put the listener *position* at the head and
  keep the camera's *orientation*, the usual third-person setup.
- **Occlusion rays must start at the head too.** Otherwise a camera pulled back through a wall or a floor lets the
  player hear into the room the camera sees. The engine traces from the listener, so moving the listener position to
  the head fixes this; Option B traces from the head directly.
- Optional script switch: `Voice.setListenerMode("character" | "camera")`, default `character`.

### Cheating

Client-side occlusion can be removed by a modified client, which would let a player eavesdrop through walls.
`strict: true` mode: each client reports the occlusion of the pairs it computes, both talker and listener; the server
takes the higher of the two reports and either drops the frames (above a threshold) or sends a graded gain through the
`setLocalVolume` path. A cheater then also needs the other side's client to lie.

## One-client test anyone can run today ([`probe/`](probe/))

A small resource spawns an NPC, sets `Audio.setEntitySwitch(npc, "ObstrOcclCalcType", "Ignore" | "SingleRay" |
"MultiRay")` and replays a file on it through `Audio.playFile(file, npc, "20")`, which is the bark host event path.
Walking upstairs, behind a wall or out through a closed door and toggling the mode shows whether those events respond
to the engine's occlusion. If they do, Option A0 needs no new acoustics at all, only the PCM stream. Results are
collected in [README.md](README.md#status).

## Test scenarios

1. Cellar / ground floor / upper floor of a tavern: no voice across floors at normal tier, muffled shout.
2. Gallery or balcony open to a hall: heard normally, because the ray is clear.
3. Closed vs open wooden door, at 2 m and 8 m.
4. Stone wall vs plank wall vs palisade.
5. Outdoors on a slope with a 3 m height difference: unaffected.
6. 20 players in one building: frame time and number of rays.

## What we can contribute

A test server with ready-made scenarios, tuning of the material scale and penalties, and a pull request for Layer 1
in MafiaHub Framework, if you would take one. Meanwhile there is a script-only fallback for floors, [voicefloors/](voicefloors/) (binary,
using `World.raycastAll(player, …)` and `Voice.setLocalMute`); we will share what we learn from it.
