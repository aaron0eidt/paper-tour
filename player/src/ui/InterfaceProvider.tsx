import { useEffect, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { AnimateUIProvider } from '@animate-ui/react/provider';
import { Toast } from '@animate-ui/react/primitives/base-ui/toast';
import { CloseIcon } from '../components/icons';
import { initializeInterfacePreferences, subscribeInterfacePreferences } from './preferences';
import {
  disposeInterfaceSounds,
  stopInterfaceSounds,
  syncInterfaceSounds,
  unlockInterfaceSounds,
} from './sound';
import './interface.css';

export const useNotice = Toast.useToastManager;

function Notices() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="ui-toast-viewport">
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} className="ui-toast" swipeDirection={['down', 'left']}>
            <Toast.Content className="ui-toast-content">
              <svg
                className="ui-toast-mark"
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="8" />
                <path d="m6 10 3 3 5-6" />
              </svg>
              <div>
                <Toast.Title className="ui-toast-title" />
                <Toast.Description className="ui-toast-description" />
              </div>
              {toast.actionProps && <Toast.Action className="ui-toast-action" />}
              <Toast.Close className="ui-close" aria-label="Dismiss notification">
                <CloseIcon />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function InterfaceProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const dispose = initializeInterfacePreferences();
    const unsubscribe = subscribeInterfacePreferences(syncInterfaceSounds);
    const gesture = (event: Event) => {
      if (event.isTrusted) unlockInterfaceSounds();
    };
    const visibility = () => {
      if (document.hidden) stopInterfaceSounds();
    };
    document.addEventListener('pointerdown', gesture, true);
    document.addEventListener('keydown', gesture, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      dispose();
      unsubscribe();
      disposeInterfaceSounds();
      document.removeEventListener('pointerdown', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <AnimateUIProvider tempo={0.8} reducedMotion="user">
        <Toast.Provider timeout={2000} limit={3} progressBar={false}>
          {children}
          <Notices />
        </Toast.Provider>
      </AnimateUIProvider>
    </MotionConfig>
  );
}
