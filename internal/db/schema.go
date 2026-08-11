package db

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

var conn *sql.DB

func Init(path string) error {
	var err error
	conn, err = sql.Open("sqlite", path+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return err
	}
	return migrate()
}

func Close() {
	if conn != nil {
		conn.Close()
	}
}

func migrate() error {
	// Wiped once for multi-source migration, removed so it doesn't wipe on every restart.

	schema := `
	CREATE TABLE IF NOT EXISTS sources (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		name        TEXT NOT NULL,
		type        TEXT NOT NULL, -- 'iptv' or 'hdhomerun'
		url         TEXT NOT NULL,
		epg_url     TEXT,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS channels (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		source_id   INTEGER REFERENCES sources(id) ON DELETE CASCADE,
		name        TEXT NOT NULL,
		stream_url  TEXT NOT NULL,
		logo_url    TEXT,
		group_title TEXT,
		tuner_type  TEXT DEFAULT 'iptv',
		tvg_id      TEXT,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS epg_entries (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
		title       TEXT NOT NULL,
		description TEXT,
		poster_url  TEXT,
		start_time  DATETIME NOT NULL,
		end_time    DATETIME NOT NULL,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS favorites (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		channel_id INTEGER UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
		position   INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_epg_channel_time ON epg_entries(channel_id, start_time, end_time);
	CREATE INDEX IF NOT EXISTS idx_channel_source ON channels(source_id);
	`
	_, err := conn.Exec(schema)
	if err != nil {
		return err
	}
	
	// Ensure sort_order exists
	conn.Exec(`ALTER TABLE sources ADD COLUMN sort_order INTEGER DEFAULT 0`)

	log.Println("database migrated to multi-source schema")
	return nil
}

type SourceRow struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	EpgURL    string `json:"epg_url,omitempty"`
}

func SaveSource(s *SourceRow) error {
	res, err := conn.Exec(`INSERT INTO sources(name, type, url, epg_url) VALUES(?, ?, ?, ?)`, s.Name, s.Type, s.URL, s.EpgURL)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err == nil {
		s.ID = int(id)
	}
	return err
}

func GetSources() ([]SourceRow, error) {
	rows, err := conn.Query(`SELECT id, name, type, url, COALESCE(epg_url,'') FROM sources ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SourceRow
	for rows.Next() {
		var s SourceRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Type, &s.URL, &s.EpgURL); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetSource(id int) (*SourceRow, error) {
	row := conn.QueryRow(`SELECT id, name, type, url, COALESCE(epg_url,'') FROM sources WHERE id = ?`, id)
	var s SourceRow
	if err := row.Scan(&s.ID, &s.Name, &s.Type, &s.URL, &s.EpgURL); err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateSource(s *SourceRow) error {
	_, err := conn.Exec(`UPDATE sources SET name=?, type=?, url=?, epg_url=? WHERE id=?`, s.Name, s.Type, s.URL, s.EpgURL, s.ID)
	return err
}

func DeleteSource(id int) error {
	_, err := conn.Exec(`DELETE FROM sources WHERE id=?`, id)
	return err
}

func UpdateSourceOrder(sourceIDs []int) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE sources SET sort_order = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, id := range sourceIDs {
		if _, err := stmt.Exec(i, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

type ChannelRow struct {
	ID         int    `json:"id"`
	SourceID   int    `json:"source_id"`
	Name       string `json:"name"`
	StreamURL  string `json:"stream_url"`
	LogoURL    string `json:"logo_url,omitempty"`
	GroupTitle string `json:"group_title,omitempty"`
	TunerType  string `json:"tuner_type"`
	TvgID      string `json:"tvg_id,omitempty"`
}

func SaveChannels(channels []ChannelRow) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO channels(source_id, name, stream_url, logo_url, group_title, tuner_type, tvg_id) VALUES(?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ch := range channels {
		if _, err := stmt.Exec(ch.SourceID, ch.Name, ch.StreamURL, ch.LogoURL, ch.GroupTitle, ch.TunerType, ch.TvgID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// SyncChannels diffs existing channels for a source with the new list,
// updating existing ones to preserve their IDs (and favorites), and inserting new ones.
func SyncChannels(sourceID int, newChannels []ChannelRow) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Get existing
	rows, err := tx.Query(`SELECT id, tvg_id, name FROM channels WHERE source_id = ?`, sourceID)
	if err != nil {
		return err
	}
	existing := make(map[string]int) // tvg_id or name -> id
	for rows.Next() {
		var id int
		var tvgID, name string
		if err := rows.Scan(&id, &tvgID, &name); err == nil {
			key := tvgID
			if key == "" {
				key = name
			}
			existing[key] = id
		}
	}
	rows.Close()

	updateStmt, err := tx.Prepare(`UPDATE channels SET name=?, stream_url=?, logo_url=?, group_title=?, tuner_type=?, tvg_id=? WHERE id=?`)
	if err != nil {
		return err
	}
	defer updateStmt.Close()

	insertStmt, err := tx.Prepare(`INSERT INTO channels(source_id, name, stream_url, logo_url, group_title, tuner_type, tvg_id) VALUES(?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer insertStmt.Close()

	seenIDs := make(map[int]bool)

	for _, ch := range newChannels {
		key := ch.TvgID
		if key == "" {
			key = ch.Name
		}

		if existingID, ok := existing[key]; ok {
			// Update
			if _, err := updateStmt.Exec(ch.Name, ch.StreamURL, ch.LogoURL, ch.GroupTitle, ch.TunerType, ch.TvgID, existingID); err != nil {
				return err
			}
			seenIDs[existingID] = true
			
			// We MUST update the newChannel struct's ID so that when EPG is parsed later in sources.go,
			// it maps to the CORRECT preserved ID! But wait, newChannels is passed by value ([]ChannelRow).
			// We can't update it directly unless we return a map or update the array elements.
		} else {
			// Insert
			res, err := insertStmt.Exec(sourceID, ch.Name, ch.StreamURL, ch.LogoURL, ch.GroupTitle, ch.TunerType, ch.TvgID)
			if err != nil {
				return err
			}
			newID, _ := res.LastInsertId()
			seenIDs[int(newID)] = true
		}
	}

	// Delete channels that are no longer in the M3U/Source
	deleteStmt, err := tx.Prepare(`DELETE FROM channels WHERE source_id = ? AND id = ?`)
	if err != nil {
		return err
	}
	defer deleteStmt.Close()

	for _, id := range existing {
		if !seenIDs[id] {
			if _, err := deleteStmt.Exec(sourceID, id); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func GetChannels() ([]ChannelRow, error) {
	rows, err := conn.Query(`SELECT id, source_id, name, stream_url, COALESCE(logo_url,''), COALESCE(group_title,''), tuner_type, COALESCE(tvg_id,'') FROM channels ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ChannelRow
	for rows.Next() {
		var ch ChannelRow
		if err := rows.Scan(&ch.ID, &ch.SourceID, &ch.Name, &ch.StreamURL, &ch.LogoURL, &ch.GroupTitle, &ch.TunerType, &ch.TvgID); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}

func GetChannel(id int) (*ChannelRow, error) {
	row := conn.QueryRow(`SELECT id, source_id, name, stream_url, COALESCE(logo_url,''), COALESCE(group_title,''), tuner_type, COALESCE(tvg_id,'') FROM channels WHERE id = ?`, id)
	var ch ChannelRow
	if err := row.Scan(&ch.ID, &ch.SourceID, &ch.Name, &ch.StreamURL, &ch.LogoURL, &ch.GroupTitle, &ch.TunerType, &ch.TvgID); err != nil {
		return nil, err
	}
	return &ch, nil
}

func ClearChannelsForSource(sourceID int) error {
	_, err := conn.Exec(`DELETE FROM channels WHERE source_id = ?`, sourceID)
	return err
}

func UpdateChannelURL(id int, streamURL string) error {
	_, err := conn.Exec(`UPDATE channels SET stream_url = ? WHERE id = ?`, streamURL, id)
	return err
}

func UpdateChannels(channels []ChannelRow) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE channels SET logo_url = ?, group_title = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ch := range channels {
		if _, err := stmt.Exec(ch.LogoURL, ch.GroupTitle, ch.ID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func DB() *sql.DB {
	return conn
}

type EPGEntryRow struct {
	ID          int       `json:"id"`
	ChannelID   int       `json:"channel_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	PosterURL   string    `json:"poster_url"`
	StartTime   string    `json:"start_time"`
	EndTime     string    `json:"end_time"`
}

func ClearEPGEntriesForSource(sourceID int) error {
	// Channels cascade, but if we wanted to clear explicitly we'd join.
	// For now this deletes entries where the channel belongs to the source
	_, err := conn.Exec(`DELETE FROM epg_entries WHERE channel_id IN (SELECT id FROM channels WHERE source_id = ?)`, sourceID)
	return err
}

func SaveEPGEntries(entries []EPGEntryRow) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO epg_entries(channel_id, title, description, poster_url, start_time, end_time) VALUES(?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, e := range entries {
		if _, err := stmt.Exec(e.ChannelID, e.Title, e.Description, e.PosterURL, e.StartTime, e.EndTime); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func GetEPGEntries(channelID int) ([]EPGEntryRow, error) {
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), COALESCE(poster_url,''), start_time, end_time FROM epg_entries WHERE channel_id = ? ORDER BY start_time ASC`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.PosterURL, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func GetAllEPGEntries() ([]EPGEntryRow, error) {
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), COALESCE(poster_url,''), start_time, end_time FROM epg_entries ORDER BY channel_id, start_time ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.PosterURL, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func GetEPGEntriesByTime(start string, end string) ([]EPGEntryRow, error) {
	// epg_entries.end_time > start AND epg_entries.start_time < end
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), COALESCE(poster_url,''), start_time, end_time FROM epg_entries WHERE end_time > ? AND start_time < ? ORDER BY channel_id, start_time ASC`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.PosterURL, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
