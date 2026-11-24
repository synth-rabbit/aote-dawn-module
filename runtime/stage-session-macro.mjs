/**
 * Ashes of the Eclipse: Dawn of Darkness — Narrator World-Staging Macro (Foundry v13+)
 *
 * Paste this script into a Foundry Script Macro (Type: Script) and run it as the
 * Narrator. It prompts for a session number (e.g., "08") or pasted plan JSON from
 * `build/aote/session-plans/session_NN_world_plan.json`, creates the private
 * `Session NN` Actor and Scene folders if missing, imports missing Scenes (with
 * navigation disabled) and missing Actors/Props/Challenges from `aote-dawn`
 * compendiums, sets default ownership to NONE (0), and renames aliased NPCs
 * (such as `Jaya, who gives the name Orsand` -> `Orsand`, `Kai` -> `Jules`).
 *
 * Existing world Actors and Scenes are preserved untouched unless an unrenamed
 * aliased NPC exists and matches `plan.renames`.
 */

const DEFAULT_MODULE_ID = "aote-dawn";

async function promptForInput() {
  const content = `
    <form class="aote-stage-form">
      <div class="form-group">
        <label for="aote-session-number">Session number (for uploaded plans)</label>
        <input id="aote-session-number" type="text" name="session" placeholder="08" value="" />
      </div>
      <div class="form-group stacked">
        <label for="aote-plan-json">Or paste <code>session_NN_world_plan.json</code></label>
        <textarea id="aote-plan-json" name="planJson" rows="10" style="font-family:monospace;font-size:12px"
          placeholder="Paste the contents of build/aote/session-plans/session_NN_world_plan.json"></textarea>
      </div>
      <p class="notes">
        Creates <code>Session NN</code> folders, imports missing Actors/Props/Challenges with
        <code>NONE</code> default ownership, imports missing Scenes with navigation hidden, and
        applies NPC display-name aliases.
      </p>
    </form>
  `;

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (DialogV2?.wait) {
    return DialogV2.wait({
      window: { title: "Stage Dawn of Darkness Session" },
      content,
      buttons: [
        {
          action: "stage",
          label: "Stage Session",
          default: true,
          callback: (_event, button) => {
            const form = button.form;
            return {
              session: form.elements.session?.value ?? "",
              planJson: form.elements.planJson?.value ?? "",
            };
          },
        },
        {
          action: "cancel",
          label: "Cancel",
          callback: () => null,
        },
      ],
    });
  }

  return Dialog.wait({
    title: "Stage Dawn of Darkness Session",
    content,
    buttons: {
      stage: {
        label: "Stage Session",
        callback: (html) => {
          const root = html instanceof HTMLElement ? html : html[0];
          return {
            session: root.querySelector('[name="session"]')?.value ?? "",
            planJson: root.querySelector('[name="planJson"]')?.value ?? "",
          };
        },
      },
      cancel: { label: "Cancel", callback: () => null },
    },
    default: "stage",
  });
}

async function loadPlan(input) {
  const pasted = (input.planJson ?? "").trim();
  if (pasted) {
    return JSON.parse(pasted);
  }
  const digits = String(input.session ?? "").trim().replace(/\D+/g, "");
  if (!digits) {
    throw new Error("Enter a two-digit session number or paste a world plan JSON.");
  }
  const nn = digits.padStart(2, "0");
  const worldPath = game.world?.id
    ? `worlds/${game.world.id}/session-plans/session_${nn}_world_plan.json`
    : null;
  const candidates = [
    worldPath,
    `modules/${DEFAULT_MODULE_ID}/session-plans/session_${nn}_world_plan.json`,
    `modules/${DEFAULT_MODULE_ID}/runtime/session-plans/session_${nn}_world_plan.json`,
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const data = await foundry.utils.fetchJsonWithTimeout(url);
      if (data && typeof data === "object" && data.folderName) {
        return data;
      }
    } catch (_err) {
      // Try next candidate path.
    }
  }
  throw new Error(
    `Could not fetch session_${nn}_world_plan.json from world or module files. ` +
    `Paste build/aote/session-plans/session_${nn}_world_plan.json directly into the dialog.`
  );
}

async function ensureFolder(name, type) {
  const existing = game.folders.find((f) => f.type === type && f.name === name && !f.folder);
  if (existing) return existing;
  return Folder.create({ name, type, folder: null, sorting: "a" });
}

function normalizeEntry(entry) {
  return typeof entry === "string" ? { name: entry } : entry;
}

async function stageSession() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only the Narrator can run session world staging.");
    return;
  }

  const NONE_OWNERSHIP = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0;

  const input = await promptForInput();
  if (!input) return;

  let plan;
  try {
    plan = await loadPlan(input);
  } catch (err) {
    ui.notifications.error(err.message);
    return;
  }

  const actorPackId = plan.packs?.actors || `${plan.moduleId || DEFAULT_MODULE_ID}.aote-actors`;
  const scenePackId = plan.packs?.scenes || `${plan.moduleId || DEFAULT_MODULE_ID}.aote-scenes`;
  const actorPack = game.packs.get(actorPackId);
  const scenePack = game.packs.get(scenePackId);
  if (!actorPack || !scenePack) {
    ui.notifications.error(`Missing compendium pack(s): ${actorPackId}, ${scenePackId}. Is ${plan.moduleId || DEFAULT_MODULE_ID} enabled?`);
    return;
  }

  await Promise.all([actorPack.getIndex(), scenePack.getIndex()]);

  const actorFolder = await ensureFolder(plan.folderName, "Actor");
  const sceneFolder = await ensureFolder(plan.folderName, "Scene");

  const summary = {
    scenesImported: [],
    scenesReused: [],
    actorsImported: [],
    actorsReused: [],
    actorsRenamed: [],
    missing: [],
  };

  for (const rawScene of plan.scenes ?? []) {
    const entry = normalizeEntry(rawScene);
    const existing = game.scenes.find(
      (s) => (entry.id && s.id === entry.id) || s.name === entry.name
    );
    if (existing) {
      summary.scenesReused.push(entry.name);
      continue;
    }
    const idx = scenePack.index.find(
      (doc) => (entry.id && doc._id === entry.id) || doc.name === entry.name
    );
    if (!idx) {
      summary.missing.push(`Scene: ${entry.name}`);
      continue;
    }
    await game.scenes.importFromCompendium(scenePack, idx._id, {
      folder: sceneFolder.id,
      navigation: false,
    });
    summary.scenesImported.push(entry.name);
  }

  const actorEntries = [];
  const seenActorNames = new Set();
  for (const rawActor of [
    ...(plan.actors ?? []),
    ...(plan.props ?? []),
    ...(plan.challengeActors ?? []),
  ]) {
    const entry = normalizeEntry(rawActor);
    if (seenActorNames.has(entry.name)) continue;
    seenActorNames.add(entry.name);
    actorEntries.push(entry);
  }

  const renames = plan.renames ?? {};

  for (const entry of actorEntries) {
    const targetName = renames[entry.name] || entry.worldName || entry.name;
    const isAliased = targetName !== entry.name;

    const existingTarget = game.actors.find((a) => a.name === targetName);
    if (existingTarget) {
      summary.actorsReused.push(targetName);
      continue;
    }

    const existingSource = isAliased ? game.actors.find((a) => a.name === entry.name) : null;
    if (existingSource) {
      await existingSource.update({
        name: targetName,
        "prototypeToken.name": targetName,
        ownership: { ...existingSource.ownership, default: NONE_OWNERSHIP },
      });
      summary.actorsRenamed.push(`${entry.name} -> ${targetName}`);
      continue;
    }

    const idx = actorPack.index.find(
      (doc) => (entry.id && doc._id === entry.id) || doc.name === entry.name
    );
    if (!idx) {
      summary.missing.push(`Actor: ${entry.name}`);
      continue;
    }

    const updateData = {
      folder: actorFolder.id,
      ownership: { default: NONE_OWNERSHIP },
    };
    if (isAliased) {
      updateData.name = targetName;
      updateData["prototypeToken.name"] = targetName;
    } else if (entry.tokenName && entry.tokenName !== entry.name) {
      updateData["prototypeToken.name"] = entry.tokenName;
    }

    await game.actors.importFromCompendium(actorPack, idx._id, updateData);
    summary.actorsImported.push(targetName);
    if (isAliased) {
      summary.actorsRenamed.push(`${entry.name} -> ${targetName}`);
    }
  }

  const headline =
    `${plan.folderName}: imported ${summary.scenesImported.length} scenes ` +
    `(${summary.scenesReused.length} existing) and ${summary.actorsImported.length} actors ` +
    `(${summary.actorsReused.length} existing, ${summary.actorsRenamed.length} renamed` +
    `${summary.missing.length ? `, ${summary.missing.length} missing` : ""}).`;

  console.info("AOTE stage-session summary:", summary);
  if (summary.missing.length) {
    ui.notifications.warn(`${headline} Missing: ${summary.missing.join(", ")}`);
  } else {
    ui.notifications.info(headline);
  }
}

await stageSession();
