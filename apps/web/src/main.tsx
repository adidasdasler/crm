import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { BookingPage } from './pages/Booking';
import { Landing } from './pages/Landing';
import { ManagePage } from './pages/Manage';
import { NotFound } from './pages/NotFound';
import { ClientConsent, OwnerConsent } from './legal/Consent';
import { Offer } from './legal/Offer';
import { Privacy } from './legal/Privacy';
import { MockPay } from './pages/MockPay';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/b/:slug" element={<BookingPage />} />
        <Route path="/b/:slug/manage/:token" element={<ManagePage />} />
        <Route path="/b/:slug/consent" element={<ClientConsent />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Offer />} />
        <Route path="/consent" element={<OwnerConsent />} />
        <Route path="/pay/mock/:id" element={<MockPay />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
