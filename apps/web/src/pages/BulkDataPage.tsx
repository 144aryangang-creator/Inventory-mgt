import { BULK_CSV_MAX_BYTES, BULK_CSV_MAX_ROWS, type BulkEntity, type BulkValidationIssue } from '@inventory/contracts/bulk-data'
import { useMemo, useState, type ChangeEvent } from 'react'
import { apiRequest } from '../lib/api'
import { useOrganization } from '../organizations/OrganizationProvider'
import '../bulk-data.css'

type ValidateResponse = {
  valid: boolean
  schemaVersion?: number
  rowCount?: number
  issues?: BulkValidationIssue[]
  error?: string
  message?: string
  requestId?: string
}

type ImportResponse = {
  batchId?: string
  rowCount?: number
  schemaVersion?: number
  issues?: BulkValidationIssue[]
  error?: string
  requestId?: string
}

const entityOptions: { value: BulkEntity; label: string; description: string }[] = [
  { value: 'items', label: 'Items', description: 'Create new active item master records.' },
  { value: 'customers', label: 'Customers', description: 'Create new customer party records.' },
  { value: 'suppliers', label: 'Suppliers', description: 'Create new supplier party records.' },
  { value: 'opening-stock', label: 'Opening Stock', description: 'Initialize untouched item/warehouse stock positions only.' },
]

function formatBytes(value: number): string {
  return value >= 1024 * 1024 ? `${Math.round(value / 1024 / 1024)} MB` : `${Math.round(value / 1024)} KB`
}

async function responseJson<T>(response: Response): Promise<T | null> {
  try { return await response.json() as T } catch { return null }
}

function downloadName(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/i.exec(disposition)
  return match?.[1] ?? fallback
}

async function downloadResponse(response: Response, fallback: string): Promise<void> {
  if (!response.ok) {
    const body = await responseJson<{ error?: string; message?: string }>(response)
    throw new Error(body?.message ?? body?.error ?? 'Download failed')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadName(response, fallback)
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function BulkDataPage() {
  const { activeOrganization } = useOrganization()
  const [entity, setEntity] = useState<BulkEntity>('items')
  const [file, setFile] = useState<File | null>(null)
  const [csv, setCsv] = useState('')
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [validation, setValidation] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [issues, setIssues] = useState<BulkValidationIssue[]>([])
  const [message, setMessage] = useState('')
  const [busyAction, setBusyAction] = useState<'template' | 'export' | 'import' | null>(null)

  const selected = useMemo(() => entityOptions.find((option) => option.value === entity)!, [entity])
  const organizationId = activeOrganization?.id ?? ''
  const canImport = validation === 'valid' && csv.length > 0 && Boolean(organizationId) && busyAction === null

  const resetFile = () => {
    setFile(null)
    setCsv('')
    setRequestKey(crypto.randomUUID())
    setValidation('idle')
    setRowCount(null)
    setIssues([])
    setMessage('')
  }

  const changeEntity = (next: BulkEntity) => {
    setEntity(next)
    resetFile()
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null
    resetFile()
    if (!selectedFile) return

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setValidation('invalid')
      setMessage('Choose a .csv file.')
      return
    }
    if (selectedFile.size > BULK_CSV_MAX_BYTES) {
      setValidation('invalid')
      setMessage(`CSV must be ${formatBytes(BULK_CSV_MAX_BYTES)} or smaller.`)
      return
    }

    try {
      const text = await selectedFile.text()
      setFile(selectedFile)
      setCsv(text)
      setRequestKey(crypto.randomUUID())
      setValidation('idle')
      setMessage('File loaded. Run Validate before importing.')
    } catch {
      setValidation('invalid')
      setMessage('Could not read the selected CSV file.')
    }
  }

  const validate = async () => {
    if (!organizationId || !csv) return
    setValidation('checking')
    setIssues([])
    setMessage('')
    setRowCount(null)

    try {
      const response = await apiRequest(`/v1/bulk-data/${entity}/validate?organizationId=${encodeURIComponent(organizationId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: csv,
      })
      const body = await responseJson<ValidateResponse>(response)
      if (response.ok && body?.valid) {
        setValidation('valid')
        setRowCount(body.rowCount ?? null)
        setMessage(`Dry run passed${body.rowCount ? ` for ${body.rowCount} row${body.rowCount === 1 ? '' : 's'}` : ''}. No data was changed.`)
        return
      }

      setValidation('invalid')
      setIssues(body?.issues ?? [])
      setMessage(body?.message ?? (body?.error ? `Validation failed: ${body.error}` : 'Validation failed.'))
    } catch (error) {
      setValidation('invalid')
      setMessage(error instanceof Error ? error.message : 'Validation request failed.')
    }
  }

  const importCsv = async () => {
    if (!canImport) return
    setBusyAction('import')
    setMessage('')
    try {
      const response = await apiRequest(
        `/v1/bulk-data/${entity}/import?organizationId=${encodeURIComponent(organizationId)}&requestKey=${encodeURIComponent(requestKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: csv },
      )
      const body = await responseJson<ImportResponse>(response)
      if (!response.ok) {
        setIssues(body?.issues ?? [])
        setValidation('invalid')
        setMessage(body?.error ? `Import failed: ${body.error}` : 'Import failed.')
        return
      }
      setMessage(`Import completed. Batch ${body?.batchId ?? 'created'}${body?.rowCount ? ` · ${body.rowCount} rows` : ''}.`)
      setValidation('idle')
      setFile(null)
      setCsv('')
      setRowCount(null)
      setIssues([])
      setRequestKey(crypto.randomUUID())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import request failed.')
    } finally {
      setBusyAction(null)
    }
  }

  const downloadTemplate = async () => {
    setBusyAction('template')
    setMessage('')
    try {
      const response = await apiRequest(`/v1/bulk-data/${entity}/template`)
      await downloadResponse(response, `${entity}-template.csv`)
      setMessage('Template downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Template download failed.')
    } finally {
      setBusyAction(null)
    }
  }

  const exportCurrent = async () => {
    if (!organizationId || entity === 'opening-stock') return
    setBusyAction('export')
    setMessage('')
    try {
      const response = await apiRequest(`/v1/bulk-data/${entity}/export?organizationId=${encodeURIComponent(organizationId)}`)
      await downloadResponse(response, `${entity}.csv`)
      setMessage('Spreadsheet-safe export downloaded.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setBusyAction(null)
    }
  }

  if (!activeOrganization) {
    return <section className="bulk-page"><div className="bulk-empty">Choose or create an organization before importing data.</div></section>
  }

  return (
    <section className="bulk-page">
      <header className="bulk-header">
        <div>
          <span className="eyebrow">Data tools</span>
          <h1>Import & Export</h1>
          <p>Versioned CSV workflows with a mandatory dry run and atomic server-side import.</p>
        </div>
        <span className="bulk-version">CSV schema v1</span>
      </header>

      <div className="bulk-notice">
        <strong>Safety rules</strong>
        <span>Maximum {BULK_CSV_MAX_ROWS.toLocaleString()} data rows / {formatBytes(BULK_CSV_MAX_BYTES)} per file. Imports create new records only. Export files are spreadsheet-safe views and should not be treated as exact round-trip import files.</span>
      </div>

      <div className="bulk-grid">
        <aside className="bulk-entities" aria-label="Import data type">
          {entityOptions.map((option) => (
            <button
              key={option.value}
              className={entity === option.value ? 'active' : ''}
              type="button"
              onClick={() => changeEntity(option.value)}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </aside>

        <div className="bulk-workspace">
          <div className="bulk-workspace-head">
            <div>
              <h2>{selected.label}</h2>
              <p>{selected.description}</p>
            </div>
            <div className="bulk-download-actions">
              <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={() => void downloadTemplate()}>
                {busyAction === 'template' ? 'Preparing…' : 'Download template'}
              </button>
              {entity !== 'opening-stock' ? (
                <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={() => void exportCurrent()}>
                  {busyAction === 'export' ? 'Exporting…' : 'Export current'}
                </button>
              ) : null}
            </div>
          </div>

          {entity === 'opening-stock' ? (
            <div className="bulk-opening-warning">
              <strong>Initialization only</strong>
              <span>Opening Stock can only be posted to an item/warehouse position with no prior inventory history. Current balances are not exported as “opening stock” because they are a different accounting concept.</span>
            </div>
          ) : null}

          <label className="bulk-file-field">
            <span>CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event)} />
            <small>{file ? `${file.name} · ${formatBytes(file.size)}` : 'Use the downloaded v1 template and keep the header order unchanged.'}</small>
          </label>

          <div className="bulk-actions">
            <button className="secondary-button" type="button" disabled={!csv || validation === 'checking' || busyAction !== null} onClick={() => void validate()}>
              {validation === 'checking' ? 'Validating…' : 'Validate / Dry Run'}
            </button>
            <button className="primary-button" type="button" disabled={!canImport} onClick={() => void importCsv()}>
              {busyAction === 'import' ? 'Importing…' : 'Import validated file'}
            </button>
          </div>

          {message ? <div className={`bulk-status ${validation}`}>{message}</div> : null}
          {validation === 'valid' ? <div className="bulk-valid">Dry run verified against current organization data. Import remains atomic and may still fail safely if records change before execution.</div> : null}

          {issues.length > 0 ? (
            <div className="bulk-issues">
              <div className="bulk-issues-head"><strong>{issues.length} validation issue{issues.length === 1 ? '' : 's'}</strong><span>Fix the CSV and validate again.</span></div>
              <div className="bulk-issues-table" role="table" aria-label="CSV validation issues">
                <div className="bulk-issues-row heading" role="row"><span>Row</span><span>Field</span><span>Code</span><span>Message</span></div>
                {issues.slice(0, 200).map((issue, index) => (
                  <div className="bulk-issues-row" role="row" key={`${issue.row}-${issue.field}-${issue.code}-${index}`}>
                    <span>{issue.row}</span><span>{issue.field || '—'}</span><code>{issue.code}</code><span>{issue.message}</span>
                  </div>
                ))}
              </div>
              {issues.length > 200 ? <small>Showing first 200 issues.</small> : null}
            </div>
          ) : null}

          {rowCount !== null ? <small className="bulk-row-count">Validated rows: {rowCount}</small> : null}
        </div>
      </div>
    </section>
  )
}
