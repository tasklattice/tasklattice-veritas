import {createContext, useCallback, useContext, useState, type ReactNode} from 'react';
import {Toast as ToastPrimitive} from 'radix-ui';
import {CircleCheck, X} from 'lucide-react';

type Notice = {id: string; message: string};
const ToastContext = createContext<((message: string) => void) | null>(null);

/** Shared Relay-style success feedback; form and request errors stay in context. */
export function ToastProvider({children}: {children: ReactNode}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((message: string) => {
    setNotices(current => [...current.slice(-2), {id: crypto.randomUUID(), message}]);
  }, []);
  const dismiss = useCallback((id: string) => {
    setNotices(current => current.filter(notice => notice.id !== id));
  }, []);

  return <ToastContext.Provider value={notify}>
    <ToastPrimitive.Provider duration={5000} swipeDirection="right" label="Notification">
      {children}
      {notices.map(notice => <ToastPrimitive.Root
        key={notice.id}
        className="app-toast"
        type="background"
        onOpenChange={open => {if (!open) dismiss(notice.id);}}
      >
        <CircleCheck className="toast-success-icon" aria-hidden="true"/>
        <ToastPrimitive.Title className="toast-message">{notice.message}</ToastPrimitive.Title>
        <ToastPrimitive.Close className="toast-close" aria-label="Dismiss notification">
          <X aria-hidden="true"/>
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>)}
      <ToastPrimitive.Viewport className="toast-viewport" label="Notifications ({hotkey})"/>
    </ToastPrimitive.Provider>
  </ToastContext.Provider>;
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast requires ToastProvider');
  return notify;
}
