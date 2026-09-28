// In-memory data set fixtures. Every call returns a fresh, schema-valid and cross-valid copy.

export const NOW = new Date("2026-09-29T12:00:00Z"); // 2026-09-29 20:00 in Asia/Taipei

const BOUNDS = { xzAbsMax: 30000000, yMin: -64, yMax: 320 };

export function createDataset() {
  return {
    manifest: { schemaVersion: 1, pointSeq: 2, changeSeq: 2, updateSeq: 1 },
    config: {
      schemaVersion: 1,
      siteUrl: "https://spacesquare640.github.io/Player-Club_Minecraft_Website/",
      discordInviteUrl: "https://discord.gg/aaUQVJeCgC",
      repo: { owner: "SpaceSquare640", name: "Player-Club_Minecraft_Website", branch: "Source_Code" },
      defaultWorldId: "player_club",
      approvers: ["SpaceSquare640"],
      changelogTimeZone: "Asia/Taipei",
    },
    editions: {
      schemaVersion: 1,
      editions: [
        { id: "java", bounds: { ...BOUNDS } },
        { id: "bedrock", bounds: { ...BOUNDS } },
      ],
    },
    worlds: {
      schemaVersion: 1,
      worlds: [
        {
          id: "player_club",
          name: "Player_Club",
          edition: "java",
          gameVersion: "latest",
          seed: "652938494491123000",
          spawn: { x: 7, y: 103, z: 5 },
          dimensions: ["overworld", "the_nether", "the_end"],
        },
      ],
    },
    tags: {
      schemaVersion: 1,
      groups: [
        { id: "facility", name: { en: "Player facilities", "zh-TW": "玩家設施" } },
        { id: "structure", name: { en: "Structures", "zh-TW": "天然結構" } },
      ],
      tags: [
        { id: "base", group: "facility", name: { en: "Base", "zh-TW": "基地" }, dimensions: ["overworld", "the_nether", "the_end"] },
        { id: "village", group: "structure", name: { en: "Village", "zh-TW": "村莊" }, dimensions: ["overworld"] },
        { id: "nether_fortress", group: "structure", name: { en: "Nether Fortress", "zh-TW": "地獄要塞" }, dimensions: ["the_nether"] },
        { id: "bedrock_only", group: "structure", name: { en: "Bedrock only", "zh-TW": "基岩版限定" }, dimensions: ["overworld"], editions: ["bedrock"] },
        { id: "old_tag", group: "facility", name: { en: "Old tag", "zh-TW": "舊標籤" }, dimensions: ["overworld"], retired: true },
      ],
    },
    vpn: {
      schemaVersion: 1,
      vpns: [
        {
          id: "kingsley_radmin",
          type: "radmin",
          networkName: "Kingsley_VPN_Room",
          contactUrl: "https://discord.com/users/958592363083743252",
          worldIds: ["player_club"],
        },
      ],
    },
    points: {
      player_club: {
        schemaVersion: 1,
        worldId: "player_club",
        points: [
          {
            id: "p0001",
            dimension: "overworld",
            name: "Village 1",
            tags: ["village", "old_tag"],
            x: -426,
            y: 72,
            z: 300,
            submittedBy: "SpaceSquare640",
            createdAt: "2026-09-28T23:00:00Z",
            updatedAt: "2026-09-28T23:00:00Z",
          },
          {
            id: "p0002",
            dimension: "the_nether",
            name: "Fortress",
            tags: ["nether_fortress"],
            x: -50,
            y: null,
            z: 40,
            note: "Near the lava lake\nWest gate",
            submittedBy: "friend-01",
            createdAt: "2026-09-28T23:10:00Z",
            updatedAt: "2026-09-29T01:00:00Z",
          },
        ],
      },
    },
    updates: {
      schemaVersion: 1,
      entries: [
        {
          id: "u0001",
          date: "2026-09-29",
          summary: { en: "Site launched", "zh-TW": "網站上線" },
          scope: { en: "Entire site", "zh-TW": "全站" },
        },
      ],
    },
    changes: {
      schemaVersion: 1,
      entries: [
        {
          id: "c0001",
          date: "2026-09-29",
          action: "add",
          target: { type: "point", worldId: "player_club", id: "p0001", dimension: "overworld", name: "Village 1" },
          summary: { en: "Added point: Village 1", "zh-TW": "新增座標：Village 1" },
          scope: { en: "Point data: Player_Club / Overworld", "zh-TW": "座標資料：Player_Club／主世界" },
          source: { type: "manual" },
        },
        {
          id: "c0002",
          date: "2026-09-29",
          action: "add",
          target: { type: "point", worldId: "player_club", id: "p0002", dimension: "the_nether", name: "Fortress" },
          summary: { en: "Added point: Fortress", "zh-TW": "新增座標：Fortress" },
          scope: { en: "Point data: Player_Club / The Nether", "zh-TW": "座標資料：Player_Club／地獄" },
          source: { type: "issue", issue: 3 },
        },
      ],
    },
    i18n: null,
  };
}

export function createDictionaries() {
  return {
    en: {
      schemaVersion: 1,
      lang: "en",
      messages: {
        "dimension.overworld": "Overworld",
        "dimension.the_end": "The End",
        "dimension.the_nether": "The Nether",
        "edition.bedrock": "Bedrock Edition",
        "edition.java": "Java Edition",
        "nav.changelog": "Change Log",
        "point.tags.more": "+{count}",
        "vpn.radmin.title": "Radmin VPN",
        "world.version.latest": "{edition} · Latest release",
      },
    },
    "zh-TW": {
      schemaVersion: 1,
      lang: "zh-TW",
      messages: {
        "dimension.overworld": "主世界",
        "dimension.the_end": "終界",
        "dimension.the_nether": "地獄",
        "edition.bedrock": "基岩版",
        "edition.java": "Java 版",
        "nav.changelog": "變更紀錄",
        "point.tags.more": "+{count}",
        "vpn.radmin.title": "Radmin VPN",
        "world.version.latest": "{edition}・最新正式版",
      },
    },
  };
}

/** Adds a second world (and its points file) to a data set. */
export function addSecondWorld(dataset, points = []) {
  dataset.worlds.worlds.push({
    id: "survival_two",
    name: "Survival Two",
    edition: "bedrock",
    gameVersion: "1.21.4",
    seed: "-12345",
    spawn: { x: 0, y: 64, z: 0 },
    dimensions: ["overworld", "the_nether"],
  });
  dataset.points.survival_two = { schemaVersion: 1, worldId: "survival_two", points };
  return dataset;
}
