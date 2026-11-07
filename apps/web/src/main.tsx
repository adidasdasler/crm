import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { BookingPage } from './pages/Booking';
import { Landing } from './pages/Landing';
import { ManagePage } from './pages/Manage';
import { NotFound } from './pages/NotFound';
import { LegalPage } from './pages/Legal';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/b/:slug" element={<BookingPage />} />
        <Route path="/b/:slug/manage/:token" element={<ManagePage />} />
        <Route path="/privacy" element={<LegalPage kind="privacy" />} />
        <Route path="/terms" element={<LegalPage kind="terms" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
