import { CheckoutSession } from '../../types';
import makePayment from '../Services/sessions/make-payment';
import submitDetails from '../Services/sessions/submit-details';
import { getStoredSession, storeSession } from './storage';
import setupSession from '../Services/sessions/setup-session';

class Session {
    private readonly session: CheckoutSession;
    public clientKey: any;
    public loadingContext: any;

    constructor(session, clientKey, loadingContext) {
        if (!session.id) throw new Error('No Session ID');
        if (!clientKey) throw new Error('No clientKey available');

        this.session = session;

        if (!this.session.data) {
            this.session = this.getStoredSession();
        } else {
            this.storeSession();
        }

        this.clientKey = clientKey;
        this.loadingContext = loadingContext;
    }

    get id() {
        return this.session.id;
    }

    get data() {
        return this.session.data;
    }

    /**
     * Updates the session.data with the latest data blob
     */
    updateSessionData(latestData: string) {
        this.session.data = latestData;
        this.storeSession();
    }

    setupSession() {
        return setupSession(this.session, { clientKey: this.clientKey, loadingContext: this.loadingContext });
    }

    /**
     * Submits a session payment
     */
    makePayment(data) {
        return makePayment(data, this).then(response => {
            if (response.sessionData) {
                this.updateSessionData(response.sessionData);
            }

            return response;
        });
    }

    /**
     * Submits session payment additional details
     */
    submitDetails(data) {
        return submitDetails(data, this).then(response => {
            if (response.sessionData) {
                this.updateSessionData(response.sessionData);
            }

            return response;
        });
    }

    getStoredSession(): CheckoutSession {
        const storedSession = getStoredSession();
        return this.id === storedSession?.id ? storedSession : this.session;
    }

    storeSession() {
        storeSession(this.session);
    }
}
export default Session;
