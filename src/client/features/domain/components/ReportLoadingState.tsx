export function ReportLoadingState({ label }: { label: string }) {
  return <div className="p-6 text-sm text-base-content/60">{label}</div>;
}

export function ReportErrorState({ message }: { message: string }) {
  return (
    <div className="alert alert-error m-4">
      <span>{message}</span>
    </div>
  );
}
