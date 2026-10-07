import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LedgerRepository } from "../db/repositories/ledger.js";
import { APP_ID, DEFAULT_PROFILE, type Profile } from "../shared/model.js";

const PROFILE_KEY = "profile";
const AVATAR_KEY = "avatar";

type StoredProfile = Omit<Profile, "hasAvatar" | "avatarVersion">;
interface StoredAvatar {
  file: string;
  type: string;
  version: number;
}

export function dataDir(): string {
  return join(homedir(), ".rome", process.env.ROME_PROFILE || "default", "apps", "data", APP_ID);
}

function avatarMeta(repo: LedgerRepository): StoredAvatar | null {
  const raw = repo.setting(AVATAR_KEY);
  if (raw) {
    try {
      const meta = JSON.parse(raw) as StoredAvatar;
      if (existsSync(join(dataDir(), meta.file))) return meta;
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function readProfile(repo: LedgerRepository): Profile {
  let stored: StoredProfile = { ...DEFAULT_PROFILE };
  const raw = repo.setting(PROFILE_KEY);
  if (raw) {
    try {
      stored = { ...stored, ...(JSON.parse(raw) as Partial<StoredProfile>) };
    } catch {
      /* keep defaults */
    }
  }
  const avatar = avatarMeta(repo);
  return { ...stored, hasAvatar: !!avatar, avatarVersion: avatar?.version ?? 0 };
}

export function saveProfile(repo: LedgerRepository, patch: Partial<StoredProfile>): Profile {
  const current = readProfile(repo);
  const next: StoredProfile = {
    name: patch.name ?? current.name,
    title: patch.title ?? current.title,
    company: patch.company ?? current.company,
    bio: patch.bio ?? current.bio,
    website: patch.website ?? current.website,
  };
  repo.setSetting(PROFILE_KEY, JSON.stringify(next));
  return readProfile(repo);
}

const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function saveAvatar(repo: LedgerRepository, type: string, bytes: Uint8Array): Profile {
  const ext = AVATAR_TYPES[type];
  if (!ext) throw new Error("Use a JPEG, PNG or WebP image.");
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const previous = avatarMeta(repo);
  const file = `avatar-${Date.now()}.${ext}`;
  writeFileSync(join(dir, file), bytes);
  if (previous && previous.file !== file) rmSync(join(dir, previous.file), { force: true });
  repo.setSetting(AVATAR_KEY, JSON.stringify({ file, type, version: (previous?.version ?? 0) + 1 }));
  return readProfile(repo);
}

export function removeAvatar(repo: LedgerRepository): Profile {
  const meta = avatarMeta(repo);
  if (meta) rmSync(join(dataDir(), meta.file), { force: true });
  repo.setSetting(AVATAR_KEY, "");
  return readProfile(repo);
}

export function avatarResponse(repo: LedgerRepository): Response {
  const meta = avatarMeta(repo);
  if (!meta) return Response.json({ error: "No avatar." }, { status: 404 });
  const bytes = readFileSync(join(dataDir(), meta.file));
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": meta.type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
