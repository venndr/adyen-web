import { Component, h } from 'preact';
import PaymentMethodList from './PaymentMethod/PaymentMethodList';
import Status from './status';
import getOrderStatus from '../../../core/Services/order-status';
import { DropinComponentProps, DropinComponentState } from '../types';
import './DropinComponent.scss';

export class DropinComponent extends Component<DropinComponentProps, DropinComponentState> {
    public state: DropinComponentState = {
        elements: [],
        orderStatus: null,
        isDisabling: false,
        status: { type: 'loading' },
        activePaymentMethod: null,
        cachedPaymentMethods: {}
    };

    componentDidMount() {
        this.prepareDropinData();
    }

    public prepareDropinData = () => {
        const { order, clientKey, loadingContext } = this.props;
        const [storedElementsPromises, elementsPromises] = this.props.onCreateElements();
        const orderStatusPromise = order ? getOrderStatus({ clientKey, loadingContext }, order) : null;

        Promise.all([storedElementsPromises, elementsPromises, orderStatusPromise]).then(([storedElements, elements, orderStatus]) => {
            this.setState({ elements: [...storedElements, ...elements], orderStatus });
            this.setStatus({ type: 'ready' });

            if (this.props.modules.analytics) {
                this.props.modules.analytics.send({
                    containerWidth: this.base && (this.base as HTMLElement).offsetWidth,
                    paymentMethods: elements.map(e => e.props.type),
                    component: 'dropin',
                    flavor: 'dropin'
                });
            }
        });
    };

    public setStatus = status => {
        this.setState({ status });
    };

    private setActivePaymentMethod = paymentMethod => {
        this.setState(prevState => ({
            activePaymentMethod: paymentMethod,
            cachedPaymentMethods: { ...prevState.cachedPaymentMethods, [paymentMethod._id]: true }
        }));
    };

    componentDidUpdate(prevProps, prevState) {
        if (prevState.status.type !== this.state.status.type && this.state.activePaymentMethod) {
            this.state.activePaymentMethod.setStatus(this.state.status.type);
        }

        if (this.state.status.type === 'ready' && prevState.status.type !== 'ready' && this.props.onReady) {
            this.props.onReady();
        }

        if (this.props.order && !prevProps.order) {
            this.props.onDropinReset();
        }
    }

    private handleOnSelectPaymentMethod = paymentMethod => {
        const { activePaymentMethod } = this.state;

        this.setActivePaymentMethod(paymentMethod);

        // onSelect event
        if ((activePaymentMethod && activePaymentMethod._id !== paymentMethod._id) || !activePaymentMethod) {
            this.props.onSelect(paymentMethod);
        }
    };

    private handleDisableStoredPaymentMethod = storedPaymentMethod => {
        this.setState({ isDisabling: true });

        new Promise((resolve, reject) => this.props.onDisableStoredPaymentMethod(storedPaymentMethod.props.storedPaymentMethodId, resolve, reject))
            .then(() => {
                this.setState(prevState => ({ elements: prevState.elements.filter(pm => pm._id !== storedPaymentMethod._id) }));
                this.setState({ isDisabling: false });
            })
            .catch(() => {
                this.setState({ isDisabling: false });
            });
    };

    public update(props) {
        this.state.elements.forEach(element => element.update(props));
    }

    closeActivePaymentMethod() {
        this.setState({ activePaymentMethod: null });
    }

    render(props, { elements, status, activePaymentMethod, cachedPaymentMethods }) {
        const isLoading = status.type === 'loading';
        const isRedirecting = status.type === 'redirect';

        switch (status.type) {
            case 'success':
                return <Status.Success message={status.props?.message} />;

            case 'error':
                return <Status.Error message={status.props?.message} />;

            case 'custom':
                return status.props.component.render();

            default:
                return (
                    <div className={`adyen-checkout__dropin adyen-checkout__dropin--${status.type}`}>
                        {isRedirecting && status.props.component && status.props.component.render()}
                        {isLoading && status.props && status.props.component && status.props.component.render()}
                        {elements && !!elements.length && (
                            <PaymentMethodList
                                isLoading={isLoading || isRedirecting}
                                isDisabling={this.state.isDisabling}
                                paymentMethods={elements}
                                activePaymentMethod={activePaymentMethod}
                                cachedPaymentMethods={cachedPaymentMethods}
                                order={this.props.order}
                                orderStatus={this.state.orderStatus}
                                onOrderCancel={this.props.onOrderCancel}
                                onSelect={this.handleOnSelectPaymentMethod}
                                openFirstPaymentMethod={this.props.openFirstPaymentMethod}
                                openFirstStoredPaymentMethod={this.props.openFirstStoredPaymentMethod}
                                onDisableStoredPaymentMethod={this.handleDisableStoredPaymentMethod}
                                showRemovePaymentMethodButton={this.props.showRemovePaymentMethodButton}
                            />
                        )}
                    </div>
                );
        }
    }
}

export default DropinComponent;
