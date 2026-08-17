import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/contexts/CartContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import ErrorBoundary from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import SuperAdmin from "./pages/SuperAdmin";
import TenantStore from "./pages/TenantStore";
import TenantAdmin from "./pages/TenantAdmin";
import TenantOrders from "./pages/TenantOrders";
import TenantOrderStatus from "./pages/TenantOrderStatus";
import TenantPaymentGateway from "./pages/TenantPaymentGateway";
import TenantSaved from "./pages/TenantSaved";
import SupplierPanel from "./pages/SupplierPanel";
import DriverPanel from "./pages/DriverPanel";
import TenantChat from "./pages/TenantChat";
import TableSession from "./pages/TableSession";
import WaiterPanel from "./pages/WaiterPanel";
import PdvMaquininha from "./pages/PdvMaquininha";
import Kds from "./pages/Kds";
import Totem from "./pages/Totem";
import NotFound from "./pages/NotFound";
import Unsubscribe from "./pages/Unsubscribe";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <CartProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/super-admin" element={<SuperAdmin />} />
                <Route path="/loja/:slug" element={<TenantStore />} />
                <Route path="/loja/:slug/admin" element={<TenantAdmin />} />
                <Route path="/loja/:slug/meus-pedidos" element={<TenantOrders />} />
                <Route path="/loja/:slug/salvos" element={<TenantSaved />} />
                <Route path="/loja/:slug/pedido/:id" element={<TenantOrderStatus />} />
                <Route path="/loja/:slug/pagar/:orderId" element={<TenantPaymentGateway />} />
                <Route path="/loja/:slug/chat" element={<TenantChat />} />
                <Route path="/loja/:slug/mesa/:code" element={<TableSession />} />
                <Route path="/loja/:slug/garcom/:token" element={<WaiterPanel />} />
                <Route path="/loja/:slug/pdv" element={<PdvMaquininha />} />
                <Route path="/loja/:slug/kds" element={<Kds />} />
                <Route path="/loja/:slug/totem" element={<Totem />} />
                <Route path="/loja/:slug/fornecedor/:token" element={<SupplierPanel />} />
                <Route path="/loja/:slug/motoboy/:token" element={<DriverPanel />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              {/* Botão flutuante global — disponível em TODAS as telas */}
              <ThemeToggle variant="floating" />
            </BrowserRouter>
          </CartProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
