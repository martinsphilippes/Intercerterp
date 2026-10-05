import {
  LayoutDashboard, ScanBarcode, Receipt, Undo2, Wallet, Package, ArrowLeftRight, Truck, ClipboardList, Tags, Users, ArrowDownCircle, ArrowUpCircle, LineChart,
  Landmark, CreditCard, Settings2, Factory, TrendingDown, Scale, ShoppingCart, BadgeCheck, PackageCheck, FileText, FileCheck2, FileSignature, FileBarChart, Cog,
  BarChart3, PieChart, ShieldCheck, Building2, Monitor, Plug, DatabaseBackup, History, SlidersHorizontal, Bell, LifeBuoy, Circle, Boxes,
} from "lucide-react";

const MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, ScanBarcode, Receipt, Undo2, Wallet, Package, ArrowLeftRight, Truck, ClipboardList, Tags, Users, ArrowDownCircle, ArrowUpCircle, LineChart,
  Landmark, CreditCard, Settings2, Factory, TrendingDown, Scale, ShoppingCart, BadgeCheck, PackageCheck, FileText, FileCheck2, FileSignature, FileBarChart, Cog,
  BarChart3, PieChart, ShieldCheck, Building2, Monitor, Plug, DatabaseBackup, History, SlidersHorizontal, Bell, LifeBuoy, Boxes,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const I = MAP[name] ?? Circle;
  return <I className={className} aria-hidden />;
}
