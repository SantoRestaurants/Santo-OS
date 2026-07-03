export default function DashboardLoading() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center bg-[#fbfaf7] text-[#766f65]">
      <div className="flex items-center gap-3 text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#ded7ca] border-t-[#e8463b]" />
        Cargando datos...
      </div>
    </div>
  );
}
