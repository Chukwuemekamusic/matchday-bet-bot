# Multi-Tenant Announcement Channels Implementation Guide

## Overview

This feature allows each Town (space) to configure their own announcement channel for automatic notifications (match cancellations, results, etc.) instead of using a single hardcoded `DEFAULT_CHANNEL_ID`.

## Benefits

- ✅ **Opt-in model** - Only Towns that want announcements set them up
- ✅ **No hardcoded config** - Removes `DEFAULT_CHANNEL_ID` from `.env`
- ✅ **Fully dynamic** - Each Town controls their own experience
- ✅ **Scalable** - Works for 1 Town or 1000 Towns

---

## Implementation Steps

### 1. Database Changes (`src/db/index.ts`)

#### Add Table Creation (in `init()` method, after bets table)

```typescript
// Create space settings table (for multi-tenant announcement channels)
this.db.exec(`
  CREATE TABLE IF NOT EXISTS space_settings (
    space_id TEXT PRIMARY KEY,
    announcement_channel_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);
```

#### Add Database Methods (at end of DatabaseService class)

```typescript
// ==================== SPACE SETTINGS ====================

/**
 * Get announcement channel for a space
 */
getSpaceAnnouncementChannel(spaceId: string): string | null {
  const stmt = this.db.prepare(`
    SELECT announcement_channel_id 
    FROM space_settings 
    WHERE space_id = ?
  `);
  const result = stmt.get(spaceId) as { announcement_channel_id: string } | undefined;
  return result?.announcement_channel_id || null;
}

/**
 * Set announcement channel for a space
 */
setSpaceAnnouncementChannel(spaceId: string, channelId: string): void {
  const stmt = this.db.prepare(`
    INSERT INTO space_settings (space_id, announcement_channel_id, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(space_id) 
    DO UPDATE SET 
      announcement_channel_id = excluded.announcement_channel_id,
      updated_at = strftime('%s', 'now')
  `);
  stmt.run(spaceId, channelId);
}

/**
 * Remove announcement channel for a space
 */
removeSpaceAnnouncementChannel(spaceId: string): void {
  const stmt = this.db.prepare(`
    DELETE FROM space_settings WHERE space_id = ?
  `);
  stmt.run(spaceId);
}

/**
 * Get all spaces with announcement channels configured
 */
getAllAnnouncementChannels(): Array<{ space_id: string; announcement_channel_id: string }> {
  const stmt = this.db.prepare(`
    SELECT space_id, announcement_channel_id 
    FROM space_settings
  `);
  return stmt.all() as Array<{ space_id: string; announcement_channel_id: string }>;
}
```

---

### 2. Add Commands to `src/commands.ts`

```typescript
// Announcement Management (Admin)
{
  name: "set_announcements",
  description: "Enable match announcements in this channel (admin only)",
},
{
  name: "announcements_off",
  description: "Disable match announcements for this Town (admin only)",
},
{
  name: "announcements_status",
  description: "Check if announcements are enabled for this Town",
},
```

---

### 3. Add Command Handlers to `src/index.ts`

Add these handlers after the existing slash commands (around line 2600+):

```typescript
// ==================== ANNOUNCEMENT MANAGEMENT ====================

// /set_announcements - Enable announcements in current channel (admin only)
bot.onSlashCommand(
  "set_announcements",
  async (handler, { channelId, spaceId, userId }) => {
    // Check if user is admin
    const isAdmin = await handler.hasAdminPermission(userId, spaceId);

    if (!isAdmin) {
      await handler.sendMessage(
        channelId,
        "❌ Only space admins can configure announcement settings."
      );
      return;
    }

    // Store this channel for announcements
    db.setSpaceAnnouncementChannel(spaceId, channelId);

    await handler.sendMessage(
      channelId,
      `✅ **Announcements Enabled**

This channel will now receive:
• Match cancellation notifications
• Match result updates
• Betting closure alerts

Use \`/announcements_off\` to disable.`
    );
  }
);

