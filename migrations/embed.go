// Package migrations exposes the embedded SQL migration files. The schema in
// these files is the single source of truth and is applied verbatim by
// PostgresStore at startup.
package migrations

import "embed"

// FS contains all *.sql migration files in filename order.
//
//go:embed *.sql
var FS embed.FS
