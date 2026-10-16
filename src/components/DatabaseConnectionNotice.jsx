"use client";
import { useDatabaseConnection } from "./DatabaseConnectionProvider";
import { useTranslation } from "@/i18n/TranslationProvider";

export default function DatabaseConnectionNotice() {
    const { status, refresh } = useDatabaseConnection();
    const { t } = useTranslation();
    if (status !== "unconfigured" && status !== "unavailable")
        return null;
    return <div role="alert" className="mx-auto mt-4 max-w-5xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
        <p className="font-semibold">{t(status === "unconfigured" ? "database.setup.title" : "database.unavailable.title")}</p>
        <p className="mt-1">{t(status === "unconfigured" ? "database.setup.description" : "database.unavailable.description")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
            <a href="https://www.mongodb.com/docs/atlas/getting-started/" target="_blank" rel="noopener noreferrer" className="underline">{t("database.setup.guide")}</a>
            <button type="button" onClick={refresh} className="font-medium underline">{t("error.tryAgain")}</button>
        </div>
    </div>;
}
