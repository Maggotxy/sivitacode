/** Options for installing a SivitaCode server artifact. */
export interface InstallOptions {
  readonly root: string
  readonly archive: string
  readonly checksum?: string
}

/** Result of installing or re-verifying one release. */
export interface InstallResult {
  readonly id: string
  readonly changed: boolean
}

/** Verify archive structure without extracting it. */
export function inspectArchive(archive: string): string[]
/** Verify every file in an extracted release. */
export function verifyRelease(root: string): Record<string, unknown>
/** Install and atomically activate one artifact. */
export function install(options: InstallOptions): InstallResult
/** Atomically activate the previous verified release. */
export function rollback(root: string): string
