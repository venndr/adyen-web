import Language from '../language';
import UIElement from '../components/UIElement';
import RiskModule from './RiskModule';
import paymentMethods, { getComponentConfiguration } from '../components';
import PaymentMethodsResponse from './ProcessResponse/PaymentMethodsResponse';
import getComponentForAction from './ProcessResponse/PaymentAction';
import resolveEnvironment from './Environment';
import Analytics from './Analytics';
import { PaymentAction } from '../types';
import { CoreOptions } from './types';
import { PaymentMethods, PaymentMethodOptions } from '../types';
import { processGlobalOptions } from './utils';
import Session from './CheckoutSession';

class Core {
    public session: Session;
    private paymentMethodsResponse: PaymentMethodsResponse;
    public modules: any;
    public options: CoreOptions;
    public components = [];

    public static readonly version = {
        version: process.env.VERSION,
        revision: process.env.COMMIT_HASH,
        branch: process.env.COMMIT_BRANCH,
        buildId: process.env.ADYEN_BUILD_ID
    };

    constructor(options: CoreOptions) {
        this.create = this.create.bind(this);
        this.createFromAction = this.createFromAction.bind(this);

        this.setOptions(options);
    }

    initialize(): Promise<this> {
        if (this.options.session) {
            this.session = new Session(this.options.session, this.options.clientKey, this.options.loadingContext);

            return this.session
                .setupSession(this.options)
                .then(sessionResponse => {
                    const amount = this.options.order ? this.options.order.remainingAmount : sessionResponse.amount;
                    this.setOptions({ ...sessionResponse, amount });
                    return this;
                })
                .catch(error => {
                    if (this.options.onError) this.options.onError(error);
                    return this;
                });
        }

        return Promise.resolve(this);
    }

    /**
     * Submit data to payments using the onSubmit event or the session flow if available
     * @param data -
     */
    public submitPayment(data): void {
        if (this.options.onSubmit) return this.options.onSubmit(data);

        if (this.session) {
            this.session
                .submitPayment(data)
                .then(response => {
                    if (response.action) {
                        if (this.options.onPaymentSubmitted) this.options.onPaymentSubmitted(response, this);
                    } else {
                        if (this.options.onPaymentCompleted) this.options.onPaymentCompleted(response, this);
                    }
                })
                .catch(error => {
                    if (this.options.onError) this.options.onError(error);
                });
        }
    }

    /**
     * Submits details using onAdditionalDetails or the session flow if available
     * @param details -
     */
    public submitDetails(details): void {
        if (this.options.onAdditionalDetails) return this.options.onAdditionalDetails(details);

        if (this.session) {
            this.session
                .submitDetails(details)
                .then(response => {
                    if (this.options.onPaymentCompleted) this.options.onPaymentCompleted(response, this);
                })
                .catch(error => {
                    if (this.options.onError) this.options.onError(error, this);
                });
        }
    }

    /**
     * Instantiates a new UIElement component ready to be mounted
     * @param paymentMethod - name or class of the paymentMethod
     * @param options - options that will be merged to the global Checkout props
     * @returns new UIElement
     */
    public create<T extends keyof PaymentMethods>(paymentMethod: T | string, options?: PaymentMethodOptions<T>): InstanceType<PaymentMethods[T]>;
    public create<T extends new (...args: any) => T, P extends ConstructorParameters<T>>(paymentMethod: T, options?: P[0]): T;
    public create(paymentMethod, options) {
        const props = this.getPropsForComponent(options);
        return paymentMethod ? this.handleCreate(paymentMethod, props) : this.handleCreateError();
    }

    /**
     * Instantiates a new element component ready to be mounted from an action object
     * @param action - action defining the component with the component data
     * @param options - options that will be merged to the global Checkout props
     * @returns new UIElement
     */
    public createFromAction(action: PaymentAction, options = {}): UIElement {
        if (action.type) {
            const paymentMethodsConfiguration = getComponentConfiguration(action.type, this.options.paymentMethodsConfiguration);
            const props = { ...processGlobalOptions(this.options), ...paymentMethodsConfiguration, ...this.getPropsForComponent(options) };
            return getComponentForAction(action, props);
        }
        return this.handleCreateError();
    }

    /**
     * Updates global configurations, resets the internal state and remounts each element.
     * @param options - props to update
     * @returns this - the element instance
     */
    public update = (options: CoreOptions = {}): Promise<this> => {
        this.setOptions(options);

        return this.initialize().then(() => {
            // Update each component under this instance
            this.components.forEach(c => c.update(this.getPropsForComponent(this.options)));

            return this;
        });
    };

    /**
     * Remove the reference of a component
     * @param component - reference to the component to be removed
     * @returns this - the element instance
     */
    public remove = (component): this => {
        this.components = this.components.filter(c => c._id !== component._id);
        component.unmount();

        return this;
    };

    /**
     * @internal
     * (Re)Initializes core options (i18n, paymentMethodsResponse, etc...)
     * @param options -
     * @returns this
     */
    private setOptions = (options): this => {
        this.options = { ...this.options, ...options };
        this.options.loadingContext = resolveEnvironment(this.options.environment);
        this.options.locale = this.options.locale || this.options.shopperLocale;

        this.modules = {
            risk: new RiskModule(this.options),
            analytics: new Analytics(this.options),
            i18n: new Language(this.options.locale, this.options.translations)
        };

        this.paymentMethodsResponse = new PaymentMethodsResponse(this.options.paymentMethodsResponse ?? this.options.paymentMethods, this.options);
        delete this.options.paymentMethods;

        return this;
    };

    /**
     * @internal
     * @param options - options that will be merged to the global Checkout props
     * @returns props for a new UIElement
     */
    private getPropsForComponent(options) {
        return {
            paymentMethods: this.paymentMethodsResponse.paymentMethods,
            storedPaymentMethods: this.paymentMethodsResponse.storedPaymentMethods,
            ...options,
            i18n: this.modules.i18n,
            modules: this.modules,
            session: this.session,
            createFromAction: this.createFromAction,
            _parentInstance: this
        };
    }

    /**
     * @internal
     */
    private handleCreate(PaymentMethod, options: any = {}): UIElement {
        const isValidClass = PaymentMethod.prototype instanceof UIElement;

        /**
         * Once we receive a valid class for a Component - create a new instance of it
         */
        if (isValidClass) {
            const paymentMethodsDetails = !options.supportedShopperInteractions ? this.paymentMethodsResponse.find(options.type) : [];

            // NOTE: will only have a value if a paymentMethodsConfiguration object is defined at top level, in the config object set when a
            // new AdyenCheckout is initialised.
            const paymentMethodsConfiguration = getComponentConfiguration(
                options.type,
                this.options.paymentMethodsConfiguration,
                !!options.storedPaymentMethodId
            );

            // Filtered global options
            const globalOptions = processGlobalOptions(this.options);

            // Merge:
            // 1. global props
            // 2. props defined on the PaymentMethod in the response object (will not have a value for the 'dropin' component)
            // 3. a paymentMethodsConfiguration object, if defined at top level
            // 4. the configuration object defined on this particular component (after it has passed through getPropsForComponent)
            const component = new PaymentMethod({ ...globalOptions, ...paymentMethodsDetails, ...paymentMethodsConfiguration, ...options });

            if (!options.isDropin) {
                this.components.push(component);
            }

            return component;
        }

        /**
         * Most common use case. Usual initial point of entry to this function.
         * When PaymentMethod is defined as a string - retrieve a component from the componentsMap and recall this function passing in a valid class
         */
        if (typeof PaymentMethod === 'string' && paymentMethods[PaymentMethod]) {
            return this.handleCreate(paymentMethods[PaymentMethod], { type: PaymentMethod, ...options });
        }

        /**
         * If we are trying to create a payment method that is in the paymentMethodsResponse & does not explicitly
         * implement a component, it will default to a redirect component
         */
        if (typeof PaymentMethod === 'string' && this.paymentMethodsResponse.has(PaymentMethod)) {
            const paymentMethodsConfiguration = getComponentConfiguration(PaymentMethod, this.options.paymentMethodsConfiguration);
            return this.handleCreate(paymentMethods.redirect, {
                ...processGlobalOptions(this.options),
                ...this.paymentMethodsResponse.find(PaymentMethod),
                ...paymentMethodsConfiguration,
                ...options
            });
        }

        /**
         * PaymentMethod is defined as a paymentMethods object (Used internally on Drop-in).
         */
        if (typeof PaymentMethod === 'object' && typeof PaymentMethod.type === 'string') {
            // paymentMethodsConfiguration object will take precedence here
            const paymentMethodsConfiguration = getComponentConfiguration(
                PaymentMethod.type,
                this.options.paymentMethodsConfiguration,
                !!PaymentMethod.storedPaymentMethodId
            );
            // handle rest of the flow normally (creating by string)
            return this.handleCreate(PaymentMethod.type, { ...PaymentMethod, ...options, ...paymentMethodsConfiguration });
        }

        return this.handleCreateError(PaymentMethod);
    }

    /**
     * @internal
     */
    private handleCreateError(paymentMethod?): never {
        const paymentMethodName = paymentMethod && paymentMethod.name ? paymentMethod.name : 'The passed payment method';
        const errorMessage = paymentMethod ? `${paymentMethodName} is not a valid Checkout Component` : 'No Payment Method component was passed';

        throw new Error(errorMessage);
    }
}

export default Core;
