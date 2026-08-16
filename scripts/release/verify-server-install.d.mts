/** Verify one server artifact through offline installation, authenticated Web readiness, and ACP negotiation. */
export function verifyServerInstall(options: { archive: string; checksum: string; requireLandlock?: boolean }): Promise<void>
