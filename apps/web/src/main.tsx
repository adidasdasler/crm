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
import { AccountConsent, ClientConsent, OwnerConsent } from './legal/Consent';
import { Offer } from './legal/Offer';
import { Privacy } from './legal/Privacy';
import { Cookies } from './legal/Cookies';
import { MasterPhotoConsent } from './legal/MasterPhotoConsent';
import { CookieNotice } from './CookieNotice';
import { MockPay } from './pages/MockPay';
import { MyPage } from './pages/My';
import { MaxEntry } from './pages/MaxEntry';
import { AdminPage } from './pages/Admin';
import { AccountForgot, AccountLogin, AccountRegister, AccountReset, AccountVerify } from './pages/Account';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/b/:slug" element={<BookingPage />} />
        <Route path="/b/:slug/manage/:token" element={<ManagePage />} />
        <Route path="/b/:slug/consent" element={<ClientConsent />} />
        <Route path="/my" element={<MyPage />} />
        <Route path="/max" element={<MaxEntry />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/account/login" element={<AccountLogin />} />
        <Route path="/account/register" element={<AccountRegister />} />
        <Route path="/account/forgot" element={<AccountForgot />} />
        <Route path="/account/reset" element={<AccountReset />} />
        <Route path="/account/verify" element={<AccountVerify />} />
        <Route path="/account/consent" element={<AccountConsent />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/cookies" element={<Cookies />} />
        <Route path="/master-photo-consent" element={<MasterPhotoConsent />} />
        <Route path="/terms" element={<Offer />} />
        <Route path="/consent" element={<OwnerConsent />} />
        <Route path="/pay/mock/:id" element={<MockPay />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <CookieNotice />
    </BrowserRouter>
  </StrictMode>,
);
