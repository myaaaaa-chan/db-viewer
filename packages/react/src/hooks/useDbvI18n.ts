import type { i18n } from "i18next";
import { useEffect, useRef, useState } from "react";
import { buildResources, createDbvI18n, DBV_NS, type DbvResources } from "../i18n/instance";

// <DbViewerProvider> が持つ専用の i18next インスタンス。language と resources の変更に追従する。
export const useDbvI18n = (language: string, resources: DbvResources | undefined): i18n => {
  const [instance] = useState(() => createDbvI18n({ language, resources }));
  const resourcesKey = JSON.stringify(resources ?? {});
  const appliedKey = useRef(resourcesKey);

  useEffect(() => {
    if (instance.language !== language) void instance.changeLanguage(language);
  }, [instance, language]);

  useEffect(() => {
    if (appliedKey.current === resourcesKey) return;
    appliedKey.current = resourcesKey;
    for (const [lng, namespaces] of Object.entries(buildResources(resources))) {
      instance.addResourceBundle(lng, DBV_NS, namespaces[DBV_NS], true, true);
    }
    // 辞書を足しただけでは再描画されないので、言語の変更として知らせる
    void instance.changeLanguage(instance.language);
  }, [instance, resources, resourcesKey]);

  return instance;
};
