import { lazy, Suspense } from "react";
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
import TenantStore from "./pages/TenantStore";
import TenantOrderStatus from "./pages/TenantOrderStatus";
import TenantPaymentGateway from "./pages/TenantPaymentGateway";
import TableSession from "./pages/TableSession";
import NotFound from "./pages/NotFound";
import Unsubscribe from "./pages/Unsubscribe";

// Code-splitting: páginas administrativas/painéis só carregam quando a rota é acessada.
// A loja pública (Index, TenantStore) continua no bundle inicial para abrir rápido.
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const TenantAdmin = lazy(() => import("./pages/TenantAdmin"));
const TenantOrders = lazy(() => import("./pages/TenantOrders"));
const TenantSaved = lazy(() => import("./pages/TenantSaved"));
const SupplierPanel = lazy(() => import("./pages/SupplierPanel"));
const DriverPanel = lazy(() => import("./pages/DriverPanel"));
const TenantChat = lazy(() => import("./pages/TenantChat"));
const WaiterPanel = lazy(() => import("./pages/WaiterPanel"));
const PdvMaquininha = lazy(() => import("./pages/PdvMaquininha"));
const Kds = lazy(() => import("./pages/Kds"));
const Totem = lazy(() => import("./pages/Totem"));

const LazyPage = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
    {children}
  </Suspense>
);

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
                <Route path="/super-admin" element={<LazyPage><SuperAdmin /></LazyPage>} />
                <Route path="/loja/:slug" element={<TenantStore />} />
                <Route path="/loja/:slug/admin" element={<LazyPage><TenantAdmin /></LazyPage>} />
                <Route path="/loja/:slug/meus-pedidos" element={<LazyPage><TenantOrders /></LazyPage>} />
                <Route path="/loja/:slug/salvos" element={<LazyPage><TenantSaved /></LazyPage>} />
                <Route path="/loja/:slug/pedido/:id" element={<TenantOrderStatus />} />
                <Route path="/loja/:slug/pagar/:orderId" element={<TenantPaymentGateway />} />
                <Route path="/loja/:slug/chat" element={<LazyPage><TenantChat /></LazyPage>} />
                <Route path="/loja/:slug/mesa/:code" element={<TableSession />} />
                <Route path="/loja/:slug/garcom/:token" element={<LazyPage><WaiterPanel /></LazyPage>} />
                <Route path="/loja/:slug/pdv" element={<LazyPage><PdvMaquininha /></LazyPage>} />
                <Route path="/loja/:slug/kds" element={<LazyPage><Kds /></LazyPage>} />
                <Route path="/loja/:slug/totem" element={<LazyPage><Totem /></LazyPage>} />
                <Route path="/loja/:slug/fornecedor/:token" element={<LazyPage><SupplierPanel /></LazyPage>} />
                <Route path="/loja/:slug/motoboy/:token" element={<LazyPage><DriverPanel /></LazyPage>} />
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
