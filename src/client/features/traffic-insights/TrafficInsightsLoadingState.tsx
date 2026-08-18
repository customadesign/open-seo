export function TrafficInsightsLoadingState() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="space-y-2 rounded-lg border border-base-300 bg-base-100 p-4"
          >
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-4 w-40" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
        <div className="flex justify-end border-b border-base-300 px-4 py-3">
          <div className="skeleton h-8 w-36" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="grid grid-cols-6 gap-3">
              <div className="skeleton col-span-2 h-4" />
              <div className="skeleton h-4" />
              <div className="skeleton h-4" />
              <div className="skeleton h-4" />
              <div className="skeleton h-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
