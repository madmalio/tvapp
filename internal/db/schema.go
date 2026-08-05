package db

import (
	"database/sql"
	"log"

	_ "github.com/mattn/go-sqlite3"
)

var conn *sql.DB

func Init(path string) error {
	var err error
	conn, err = sql.Open("sqlite3", path+"?_journal_mode=WAL&_foreign_keys=on")
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
	schema := `
	CREATE TABLE IF NOT EXISTS channels (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
		start_time  DATETIME NOT NULL,
		end_time    DATETIME NOT NULL,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS favorites (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		channel_id INTEGER UNIQUE REFERENCES channels(id),
		position   INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_epg_channel_time ON epg_entries(channel_id, start_time, end_time);
	`
	_, err := conn.Exec(schema)
	if err != nil {
		return err
	}
	
	// Best-effort migration for existing DB
	_, _ = conn.Exec(`ALTER TABLE channels ADD COLUMN tvg_id TEXT`)
	
	log.Println("database migrated")
	return nil
}

type ChannelRow struct {
	ID         int    `json:"id"`
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

	stmt, err := tx.Prepare(`INSERT INTO channels(name, stream_url, logo_url, group_title, tuner_type, tvg_id) VALUES(?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ch := range channels {
		if _, err := stmt.Exec(ch.Name, ch.StreamURL, ch.LogoURL, ch.GroupTitle, ch.TunerType, ch.TvgID); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func GetChannels() ([]ChannelRow, error) {
	rows, err := conn.Query(`SELECT id, name, stream_url, COALESCE(logo_url,''), COALESCE(group_title,''), tuner_type, COALESCE(tvg_id,'') FROM channels ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ChannelRow
	for rows.Next() {
		var ch ChannelRow
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.StreamURL, &ch.LogoURL, &ch.GroupTitle, &ch.TunerType, &ch.TvgID); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}

func GetChannel(id int) (*ChannelRow, error) {
	row := conn.QueryRow(`SELECT id, name, stream_url, COALESCE(logo_url,''), COALESCE(group_title,''), tuner_type, COALESCE(tvg_id,'') FROM channels WHERE id = ?`, id)
	var ch ChannelRow
	if err := row.Scan(&ch.ID, &ch.Name, &ch.StreamURL, &ch.LogoURL, &ch.GroupTitle, &ch.TunerType, &ch.TvgID); err != nil {
		return nil, err
	}
	return &ch, nil
}

func ClearChannels() error {
	_, err := conn.Exec(`DELETE FROM channels`)
	return err
}

func UpdateChannelURL(id int, streamURL string) error {
	_, err := conn.Exec(`UPDATE channels SET stream_url = ? WHERE id = ?`, streamURL, id)
	return err
}

func DB() *sql.DB {
	return conn
}

type EPGEntryRow struct {
	ID          int       `json:"id"`
	ChannelID   int       `json:"channel_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	StartTime   string    `json:"start_time"`
	EndTime     string    `json:"end_time"`
}

func ClearEPGEntries() error {
	_, err := conn.Exec(`DELETE FROM epg_entries`)
	return err
}

func SaveEPGEntries(entries []EPGEntryRow) error {
	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO epg_entries(channel_id, title, description, start_time, end_time) VALUES(?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, e := range entries {
		if _, err := stmt.Exec(e.ChannelID, e.Title, e.Description, e.StartTime, e.EndTime); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func GetEPGEntries(channelID int) ([]EPGEntryRow, error) {
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), start_time, end_time FROM epg_entries WHERE channel_id = ? ORDER BY start_time ASC`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func GetAllEPGEntries() ([]EPGEntryRow, error) {
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), start_time, end_time FROM epg_entries ORDER BY channel_id, start_time ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func GetEPGEntriesByTime(start string, end string) ([]EPGEntryRow, error) {
	// epg_entries.end_time > start AND epg_entries.start_time < end
	rows, err := conn.Query(`SELECT id, channel_id, title, COALESCE(description,''), start_time, end_time FROM epg_entries WHERE end_time > ? AND start_time < ? ORDER BY channel_id, start_time ASC`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EPGEntryRow
	for rows.Next() {
		var e EPGEntryRow
		if err := rows.Scan(&e.ID, &e.ChannelID, &e.Title, &e.Description, &e.StartTime, &e.EndTime); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
