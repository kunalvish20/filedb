"use client";
export default function PrinterDevicePicker({ devices, selectedPath, radioName, onPick, isBadged, badgeLabel, renderRowExtra, }) {
    return (<div className="space-y-2">
      {devices.map((d) => {
            const selected = selectedPath === d.path;
            return (<label key={d.path} className={`flex items-start gap-2 p-3 border rounded cursor-pointer ${selected
                    ? "border-primary bg-muted dark:bg-blue-950/40"
                    : "border-border dark:border-border"}`}>
            <input type="radio" name={radioName} checked={selected} onChange={() => onPick(d.path)} className="mt-0.5"/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {d.friendlyName}
                {isBadged(d) && (<span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
                    {badgeLabel}
                  </span>)}
              </p>
              <code className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {d.path}
              </code>
              {renderRowExtra?.(d)}
            </div>
          </label>);
        })}
    </div>);
}
