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

func WipeAllData() error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	tables := []string{"epg_entries", "channels", "sources", "recordings", "settings"}
	for _, t := range tables {
		if _, err := tx.Exec("DELETE FROM " + t); err != nil {
			return err
		}
	}
	
	if _, err := tx.Exec("DELETE FROM sqlite_sequence"); err != nil {
		return err
	}

	return tx.Commit()
}

func migrate() error {
	// Wiped once for multi-source migration, removed so it doesn't wipe on every restart.

	schema := `
	CREATE TABLE IF NOT EXISTS profiles (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT NOT NULL,
		avatar_url TEXT,
		is_admin   BOOLEAN DEFAULT 0,
		pin        TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS sources (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
		name        TEXT NOT NULL,
		type        TEXT NOT NULL, -- 'iptv' or 'hdhomerun'
		url         TEXT NOT NULL,
		epg_url     TEXT,
		sort_order  INTEGER DEFAULT 0,
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

	CREATE TABLE IF NOT EXISTS settings (
		key   TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS recordings (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		profile_id  INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
		channel_id  INTEGER REFERENCES channels(id) ON DELETE CASCADE,
		epg_id      INTEGER,
		title       TEXT NOT NULL,
		start_time  DATETIME NOT NULL,
		end_time    DATETIME NOT NULL,
		status      TEXT DEFAULT 'scheduled',
		file_path   TEXT,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_epg_channel_time ON epg_entries(channel_id, start_time, end_time);
	CREATE INDEX IF NOT EXISTS idx_epg_time ON epg_entries(end_time, start_time);
	CREATE INDEX IF NOT EXISTS idx_channel_source ON channels(source_id);
	`
	_, err := conn.Exec(schema)
	if err != nil {
		return err
	}

	// Migrations
	conn.Exec(`ALTER TABLE profiles ADD COLUMN pin TEXT DEFAULT ''`)

	// Recreate favorites table properly
	conn.Exec(`DROP TABLE IF EXISTS favorites`)
	conn.Exec(`
		CREATE TABLE IF NOT EXISTS favorites (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
			channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
			position   INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(profile_id, channel_id)
		)
	`)
	
	// Clean up old RTSP channels from previous implementation
	conn.Exec(`DELETE FROM channels WHERE tuner_type = 'rtsp' OR group_title = 'Cameras' OR source_id IN (SELECT id FROM sources WHERE type = 'rtsp')`)

	log.Println("database migrated to multi-source schema")
	return nil
}

type SourceRow struct {
	ID        int    `json:"id"`
	ProfileID *int   `json:"profile_id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	EpgURL    string `json:"epg_url,omitempty"`
}

func SaveSource(s *SourceRow) error {
	res, err := conn.Exec(`INSERT INTO sources(profile_id, name, type, url, epg_url) VALUES(?, ?, ?, ?, ?)`, s.ProfileID, s.Name, s.Type, s.URL, s.EpgURL)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err == nil {
		s.ID = int(id)
	}
	return err
}

func GetSources(profileID int) ([]SourceRow, error) {
	rows, err := conn.Query(`SELECT id, profile_id, name, type, url, COALESCE(epg_url,'') FROM sources WHERE profile_id = ? OR type = 'rtsp' ORDER BY sort_order ASC, id ASC`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SourceRow
	for rows.Next() {
		var s SourceRow
		if err := rows.Scan(&s.ID, &s.ProfileID, &s.Name, &s.Type, &s.URL, &s.EpgURL); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetAllSources() ([]SourceRow, error) {
	rows, err := conn.Query(`SELECT id, profile_id, name, type, url, COALESCE(epg_url,'') FROM sources ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SourceRow
	for rows.Next() {
		var s SourceRow
		if err := rows.Scan(&s.ID, &s.ProfileID, &s.Name, &s.Type, &s.URL, &s.EpgURL); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func GetSource(id int) (*SourceRow, error) {
	row := conn.QueryRow(`SELECT id, profile_id, name, type, url, COALESCE(epg_url,'') FROM sources WHERE id = ?`, id)
	var s SourceRow
	if err := row.Scan(&s.ID, &s.ProfileID, &s.Name, &s.Type, &s.URL, &s.EpgURL); err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateSource(s *SourceRow) error {
	_, err := conn.Exec(`UPDATE sources SET profile_id=?, name=?, type=?, url=?, epg_url=? WHERE id=?`, s.ProfileID, s.Name, s.Type, s.URL, s.EpgURL, s.ID)
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

func GetChannels(profileID int) ([]ChannelRow, error) {
	query := `
		SELECT c.id, c.source_id, c.name, c.stream_url, COALESCE(c.logo_url,''), COALESCE(c.group_title,''), c.tuner_type, COALESCE(c.tvg_id,'') 
		FROM channels c
		JOIN sources s ON c.source_id = s.id
	`
	
	var rows *sql.Rows
	var err error
	
	if profileID > 0 {
		query += ` WHERE s.profile_id = ? ORDER BY c.id`
		rows, err = conn.Query(query, profileID)
	} else {
		query += ` ORDER BY c.id`
		rows, err = conn.Query(query)
	}

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

func GetAllEPGEntries(profileID int) ([]EPGEntryRow, error) {
	query := `
		SELECT e.id, e.channel_id, e.title, COALESCE(e.description,''), COALESCE(e.poster_url,''), e.start_time, e.end_time 
		FROM epg_entries e
		JOIN channels c ON e.channel_id = c.id
		JOIN sources s ON c.source_id = s.id
	`
	
	var rows *sql.Rows
	var err error
	
	if profileID > 0 {
		query += ` WHERE s.profile_id = ? ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query, profileID)
	} else {
		query += ` ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query)
	}
	
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

func GetEPGEntriesByTime(start string, end string, profileID int) ([]EPGEntryRow, error) {
	query := `
		SELECT e.id, e.channel_id, e.title, COALESCE(e.description,''), COALESCE(e.poster_url,''), e.start_time, e.end_time 
		FROM epg_entries e
		JOIN channels c ON e.channel_id = c.id
		JOIN sources s ON c.source_id = s.id
		WHERE (e.end_time > ? AND e.start_time < ?)
	`
	
	var rows *sql.Rows
	var err error
	
	if profileID > 0 {
		query += ` AND s.profile_id = ? ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query, start, end, profileID)
	} else {
		query += ` ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query, start, end)
	}

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

func GetEPGEntriesByTimeAndSource(sourceID int, start string, end string, profileID int) ([]EPGEntryRow, error) {
	query := `
		SELECT e.id, e.channel_id, e.title, COALESCE(e.description,''), COALESCE(e.poster_url,''), e.start_time, e.end_time 
		FROM epg_entries e
		JOIN channels c ON e.channel_id = c.id
		JOIN sources s ON c.source_id = s.id
		WHERE c.source_id = ? AND e.end_time > ? AND e.start_time < ?
	`
	
	var rows *sql.Rows
	var err error
	
	if profileID > 0 {
		query += ` AND s.profile_id = ? ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query, sourceID, start, end, profileID)
	} else {
		query += ` ORDER BY e.channel_id, e.start_time ASC`
		rows, err = conn.Query(query, sourceID, start, end)
	}
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

func GetSetting(key string, defaultValue string) string {
	var val string
	err := conn.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&val)
	if err == sql.ErrNoRows || err != nil {
		return defaultValue
	}
	return val
}

func SetSetting(key string, value string) error {
	_, err := conn.Exec(`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func GetAllSettings() (map[string]string, error) {
	rows, err := conn.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			settings[k] = v
		}
	}
	return settings, nil
}

type RecordingRow struct {
	ID        int    `json:"id"`
	ProfileID int    `json:"profile_id"`
	ChannelID int    `json:"channel_id"`
	EpgID     int    `json:"epg_id,omitempty"`
	Title     string `json:"title"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Status    string `json:"status"`
	FilePath  string `json:"file_path,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

func SaveRecording(r *RecordingRow) error {
	res, err := conn.Exec(`INSERT INTO recordings(profile_id, channel_id, epg_id, title, start_time, end_time, status) VALUES(?, ?, ?, ?, ?, ?, ?)`,
		r.ProfileID, r.ChannelID, r.EpgID, r.Title, r.StartTime, r.EndTime, r.Status)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err == nil {
		r.ID = int(id)
	}
	return err
}

func GetRecordings(profileID int) ([]RecordingRow, error) {
	rows, err := conn.Query(`SELECT id, profile_id, channel_id, COALESCE(epg_id, 0), title, start_time, end_time, status, COALESCE(file_path, ''), created_at FROM recordings WHERE profile_id = ? ORDER BY start_time ASC`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecordingRow
	for rows.Next() {
		var r RecordingRow
		if err := rows.Scan(&r.ID, &r.ProfileID, &r.ChannelID, &r.EpgID, &r.Title, &r.StartTime, &r.EndTime, &r.Status, &r.FilePath, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetAllRecordings() ([]RecordingRow, error) {
	rows, err := conn.Query(`SELECT id, profile_id, channel_id, COALESCE(epg_id, 0), title, start_time, end_time, status, COALESCE(file_path, ''), created_at FROM recordings ORDER BY start_time ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecordingRow
	for rows.Next() {
		var r RecordingRow
		if err := rows.Scan(&r.ID, &r.ProfileID, &r.ChannelID, &r.EpgID, &r.Title, &r.StartTime, &r.EndTime, &r.Status, &r.FilePath, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetRecording(id int) (*RecordingRow, error) {
	row := conn.QueryRow(`SELECT id, profile_id, channel_id, COALESCE(epg_id, 0), title, start_time, end_time, status, COALESCE(file_path, ''), created_at FROM recordings WHERE id = ?`, id)
	var r RecordingRow
	if err := row.Scan(&r.ID, &r.ProfileID, &r.ChannelID, &r.EpgID, &r.Title, &r.StartTime, &r.EndTime, &r.Status, &r.FilePath, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func UpdateRecordingStatus(id int, status string, filePath string) error {
	_, err := conn.Exec(`UPDATE recordings SET status = ?, file_path = ? WHERE id = ?`, status, filePath, id)
	return err
}

func DeleteRecording(id int) error {
	_, err := conn.Exec(`DELETE FROM recordings WHERE id = ?`, id)
	return err
}

type ProfileRow struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	IsAdmin   bool   `json:"is_admin"`
	HasPin    bool   `json:"has_pin"`
	Pin       string `json:"-"`
	CreatedAt string `json:"created_at,omitempty"`
}

func GetProfiles() ([]ProfileRow, error) {
	rows, err := conn.Query(`SELECT id, name, avatar_url, is_admin, pin, created_at FROM profiles ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ProfileRow
	for rows.Next() {
		var p ProfileRow
		if err := rows.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.IsAdmin, &p.Pin, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.HasPin = (p.Pin != "")
		out = append(out, p)
	}
	return out, rows.Err()
}

func GetProfile(id int) (*ProfileRow, error) {
	row := conn.QueryRow(`SELECT id, name, avatar_url, is_admin, pin, created_at FROM profiles WHERE id = ?`, id)
	var p ProfileRow
	if err := row.Scan(&p.ID, &p.Name, &p.AvatarURL, &p.IsAdmin, &p.Pin, &p.CreatedAt); err != nil {
		return nil, err
	}
	p.HasPin = (p.Pin != "")
	return &p, nil
}

func SaveProfile(p *ProfileRow) error {
	res, err := conn.Exec(`INSERT INTO profiles (name, avatar_url, is_admin, pin) VALUES (?, ?, ?, ?)`, p.Name, p.AvatarURL, p.IsAdmin, p.Pin)
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err == nil {
		p.ID = int(id)
	}
	return err
}

func UpdateProfile(p *ProfileRow) error {
	_, err := conn.Exec(`UPDATE profiles SET name = ?, avatar_url = ?, is_admin = ?, pin = ? WHERE id = ?`, p.Name, p.AvatarURL, p.IsAdmin, p.Pin, p.ID)
	return err
}

func DeleteProfile(id int) error {
	_, err := conn.Exec(`DELETE FROM profiles WHERE id=?`, id)
	return err
}
