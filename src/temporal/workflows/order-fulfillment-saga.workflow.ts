import { isCancellation, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext } from "../contracts.js";
import { orderFulfillmentSagaStateQuery, showcaseActivities, ensureWorkflowExecutionProjection, type OrderFulfillmentSagaWorkflowInput, type OrderFulfillmentSagaState } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function orderFulfillmentSagaWorkflow(
  input: OrderFulfillmentSagaWorkflowInput,
  context: PlatformWorkflowContext
): Promise<OrderFulfillmentSagaState> {
 return runVersionedWorkflow(context, async()=>{
  const info = workflowInfo();
  const state: OrderFulfillmentSagaState = {
    orderId: input.orderId,
    customerId: input.customerId,
    status: "created",
    totalAmount: input.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    completedSideEffects: [],
    compensationHistory: [],
    inventoryState: "idle",
    paymentState: "idle",
    shipmentState: "idle",
    orderRecordState: "idle",
  };
  const compensations: Array<{ name: string; run: () => Promise<void> }> = [];

  setHandler(orderFulfillmentSagaStateQuery, () => state);
  await ensureWorkflowExecutionProjection(input, context);

  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.orderFulfillmentSaga">,
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}`,
      payload,
    });

  try {
    await runStep("createOrder", {
      orderId: input.orderId,
      customerId: input.customerId,
      itemCount: input.items.length,
      totalAmount: state.totalAmount,
    });
    state.orderRecordState = "created";
    state.completedSideEffects.push("Create Order Record");
    compensations.push({
      name: "Cancel Order",
      run: async () => {
        await runStep("cancelOrder", { orderId: input.orderId });
        state.orderRecordState = "cancelled";
      },
    });

    state.status = "reserving_inventory";
    await runStep("reserveInventory", {
      orderId: input.orderId,
      items: input.items,
    });
    state.inventoryState = "reserved";
    state.completedSideEffects.push("Reserve Inventory");
    compensations.push({
      name: "Release Inventory",
      run: async () => {
        await runStep("releaseInventory", { orderId: input.orderId, items: input.items });
        state.inventoryState = "released";
      },
    });

    state.status = "charging_payment";
    const payment = await runStep("chargePayment", {
      orderId: input.orderId,
      amount: state.totalAmount,
      paymentTokenRef: input.paymentTokenRef,
    });
    state.transactionId = String(payment.echoed.transactionId ?? `tx_${input.orderId}`);
    state.paymentState = "charged";
    state.completedSideEffects.push("Charge Payment");
    compensations.push({
      name: "Refund Payment",
      run: async () => {
        await runStep("refundPayment", { orderId: input.orderId, amount: state.totalAmount });
        state.paymentState = "refunded";
      },
    });

    state.status = "creating_shipment";
    if (input.fulfillmentScenario === "shipment_rejected") {
      throw new Error("Synthetic shipping carrier rejected the shipment");
    }
    const shipment = await runStep("createShipment", {
      orderId: input.orderId,
      shippingAddress: input.shippingAddress,
    });
    state.trackingNumber = String(shipment.echoed.trackingNumber ?? `tr_${input.orderId}`);
    state.shipmentState = "created";
    state.completedSideEffects.push("Create Shipment");
    compensations.push({
      name: "Cancel Shipment",
      run: async () => {
        await runStep("cancelShipment", { orderId: input.orderId, trackingNumber: state.trackingNumber ?? null });
        state.shipmentState = "cancelled";
      },
    });

    state.status = "sending_confirmation";
    await runStep("sendOrderConfirmation", {
      orderId: input.orderId,
      email: input.email,
      trackingNumber: state.trackingNumber ?? null,
    });
    state.completedSideEffects.push("Send Confirmation");

    state.status = "completed";
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.status = "cancelled";
      throw err;
    }

    state.lastError = err instanceof Error ? err.message : "Order fulfillment failed";
    state.status = "compensating";
    for (let index = compensations.length - 1; index >= 0; index -= 1) {
      const compensation = compensations[index];
      await compensation.run();
      state.compensationHistory.push(compensation.name);
    }
    state.status = "compensated";
    return state;
  }

 });
}
