"use client";
import Link from "next/link";
import { INDIAN_CURRENCY, formatIndianRupees } from "@/lib/currency";
import { useTranslation } from "@/i18n/TranslationProvider";
import { LOCALES } from "@/i18n";
import ThemeSection from "@/components/ThemeSection";
import DateFormatSection from "@/components/DateFormatSection";
import NumberFormatSection from "@/components/NumberFormatSection";
export default function UiSettingsPage() {
    const { t, locale, setLocale } = useTranslation();
    return (<main id="main-content" className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/settings" className="text-foreground hover:underline text-sm">
        {t("settings.back")}
      </Link>
      <h1 className="text-3xl font-bold mb-2 mt-2">{t("settings.group.ui")}</h1>
      <p className="text-gray-500 text-sm mb-8">{t("settings.group.ui.desc")}</p>

      <div className="space-y-4">
        {/* Currency */}
        <div className="rounded-lg border border-border dark:border-border p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 mb-1">{t("settings.currency")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("settings.currencyDesc")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-muted/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-semibold text-foreground" aria-hidden="true">{INDIAN_CURRENCY.symbol}</span>
              <div>
                <p className="text-sm font-semibold text-foreground">{INDIAN_CURRENCY.name}</p>
                <p className="text-xs text-muted-foreground">{INDIAN_CURRENCY.code}</p>
              </div>
            </div>
            <p className="text-sm font-medium tabular-nums text-foreground">{formatIndianRupees(123456.78)}</p>
          </div>
        </div>

        {/* Theme */}
        <ThemeSection />

        {/* Date format */}
        <DateFormatSection />

        {/* Number format */}
        <NumberFormatSection />

        {/* Language */}
        <div className="rounded-lg border border-border dark:border-border p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-200 mb-1">{t("settings.language")}</h2>
          <p className="text-sm text-gray-500 mb-4">{t("settings.languageDesc")}</p>
          <div className="flex gap-2">
            {LOCALES.map((l) => (<button key={l.code} type="button" onClick={() => setLocale(l.code)} className={`px-4 py-2 text-sm rounded border transition-colors ${locale === l.code
                ? "border-primary bg-muted dark:bg-primary/20 text-foreground dark:text-foreground"
                : "border-border dark:border-border text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-800 dark:hover:text-gray-300"}`}>
                {l.nativeName}
              </button>))}
          </div>
        </div>
      </div>
    </main>);
}
