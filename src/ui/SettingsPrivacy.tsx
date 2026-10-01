import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_NAME } from "../constants";
import { getRelayConsent, setRelayConsent, type RelayConsent } from "../store/url-import";
import {
  remoteImagePolicyActive,
  remoteImagePolicySupported,
  remoteImagesBlocked,
  setRemoteImagesBlocked,
} from "../utils/remote-images";
import { useT } from "../i18n";

/**
 * Settings ▸ Privacy (A076): the two ways a document can reach the network
 * without the user typing an address into a browser — the import relay and
 * remote images — each under the user's control.
 */
export function PrivacySection({ open }: { open: boolean }) {
  const t = useT();
  const [relay, setRelay] = useState<RelayConsent | null>(() => getRelayConsent());
  const [blockImages, setBlockImages] = useState(() => remoteImagesBlocked());
  const supported = remoteImagePolicySupported();
  const active = remoteImagePolicyActive();

  // The consent can change from the import dialog while this sheet is closed.
  useEffect(() => {
    if (!open) return;
    setRelay(getRelayConsent());
    setBlockImages(remoteImagesBlocked());
  }, [open]);

  const changeRelay = (allow: boolean) => {
    const v: RelayConsent = allow ? "allow" : "deny";
    setRelayConsent(v);
    setRelay(v);
  };
  const changeImages = (block: boolean) => {
    setRemoteImagesBlocked(block);
    setBlockImages(block);
  };

  return (
    <section className="space-y-3" aria-label={t("settings.privacy")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("settings.privacy")}</h3>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="pref-import-relay" className="text-sm">{t("settings.importRelay")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.importRelayDesc", { app: APP_NAME })}
          </p>
          {relay === null && (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("settings.importRelayUndecided")}</p>
          )}
        </div>
        <Switch id="pref-import-relay" checked={relay === "allow"} onCheckedChange={changeRelay} />
      </div>
      {/* Only where the page enforces it: the app shell installs the policy at
          startup; a library host never does (it must not restrict its page). */}
      {supported && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="pref-block-remote-images" className="text-sm">{t("settings.blockRemoteImages")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.blockRemoteImagesDesc")}
            </p>
            {blockImages !== active && (
              <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {t("settings.takesEffectNextLoad")}
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] pointer-coarse:h-8" onClick={() => window.location.reload()}>
                  <RefreshCw className="size-3" /> {t("settings.reloadNow")}
                </Button>
              </p>
            )}
          </div>
          <Switch id="pref-block-remote-images" checked={blockImages} onCheckedChange={changeImages} />
        </div>
      )}
    </section>
  );
}
