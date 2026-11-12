import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import '@fontsource/yeseva-one/400.css';
import './index.css';
import { BookingPage } from './pages/Booking';
import { Landing } from './pages/Landing';
import { ManagePage } from './pages/Manage';
import { NotFound } from './pages/NotFound';
import { ClientConsent, OwnerConsent } from './legal/Consent';
import { Offer } from './legal/Offer';
import { Privacy } from './legal/Privacy';
import { MockPay } from './pages/MockPay';
import { MyPage } from './pages/My';
import { AdminPage } from './pages/Admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/b/:slug" element={<BookingPage />} />
        <Route path="/b/:slug/manage/:token" element={<ManagePage />} />
        <Route path="/b/:slug/consent" element={<ClientConsent />} />
        <Route path="/my" element={<MyPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Offer />} />
        <Route path="/consent" element={<OwnerConsent />} />
        <Route path="/pay/mock/:id" element={<MockPay />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
