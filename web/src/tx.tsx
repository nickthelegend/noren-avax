/** One link for every transaction Noren shows: Snowtrace on Avalanche Fuji, opened in a new tab. */
import type { ReactNode } from "react";
import { short } from "./lib/api";
import { txUrl } from "./lib/chain";
import { Icon } from "./ui";

export function TxLink({ hash, n = 6, children }: { hash?: string | null; n?: number; children?: ReactNode }) {
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return hash ? <span className="mono faint">{short(hash, n)}</span> : <span className="faint">–</span>;
  return (
    <a className="tx-link" href={txUrl(hash)} target="_blank" rel="noreferrer" title={`${hash}: opens Snowtrace (Fuji) in a new tab`} onClick={(e) => e.stopPropagation()}>
      {children ?? short(hash, n)}<Icon.ext />
    </a>
  );
}
